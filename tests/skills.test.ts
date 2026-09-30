import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateBridge } from "../src/core/bridge.js";
import { BUNDLED_SKILLS, bundledSkillsDir, installSkills, resolveSkillsTarget, uninstallSkills } from "../src/core/skills.js";
import { PACKAGE_VERSION } from "../src/core/version.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
let tempDir: string;

function frontmatter(file: string): Record<string, unknown> {
  const match = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${file} has no frontmatter`);
  return YAML.parse(match[1]) as Record<string, unknown>;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bridge-skills-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("bundled skills", () => {
  it("ships every skill with frontmatter whose name matches its directory", () => {
    const dirs = fs.readdirSync(bundledSkillsDir()).sort();
    expect(dirs).toEqual([...BUNDLED_SKILLS].sort());
    for (const skill of BUNDLED_SKILLS) {
      const meta = frontmatter(path.join(bundledSkillsDir(), skill, "SKILL.md"));
      expect(meta.name).toBe(skill);
      expect(String(meta.description).length).toBeGreaterThan(40);
    }
  });

  it("keeps /handoff user-invoked with a next-session argument", () => {
    const meta = frontmatter(path.join(bundledSkillsDir(), "handoff", "SKILL.md"));
    expect(meta["disable-model-invocation"]).toBe(true);
    expect(meta["argument-hint"]).toBeTruthy();
  });

  it("ships identical, schema-valid bridge templates", () => {
    const a = fs.readFileSync(path.join(bundledSkillsDir(), "harness-bridge", "template.md"), "utf8");
    const b = fs.readFileSync(path.join(bundledSkillsDir(), "handoff", "template.md"), "utf8");
    expect(b).toBe(a);
    expect(validateBridge(a)).toMatchObject({ valid: true, errors: [] });
  });

  it("keeps package, MCP server, and plugin versions in sync", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const plugin = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8"));
    expect(pkg.version).toBe(PACKAGE_VERSION);
    expect(plugin.version).toBe(PACKAGE_VERSION);
    expect(pkg.files).toContain("skills");
  });
});

describe("skill installer", () => {
  it("resolves agent and scope targets", () => {
    expect(resolveSkillsTarget({ homeDir: "/home/u" })).toBe(path.join("/home/u", ".claude/skills"));
    expect(resolveSkillsTarget({ agent: "codex", homeDir: "/home/u" })).toBe(path.join("/home/u", ".codex/skills"));
    expect(resolveSkillsTarget({ agent: "claude-code", scope: "project", cwd: "/repo" })).toBe(path.join("/repo", ".claude/skills"));
    expect(resolveSkillsTarget({ agent: "cursor", scope: "project", cwd: "/repo" })).toBe(path.join("/repo", ".agents/skills"));
    expect(resolveSkillsTarget({ dir: "custom", cwd: "/repo" })).toBe(path.join("/repo", "custom"));
  });

  it("installs, re-installs idempotently, and uninstalls", () => {
    const first = installSkills({ dir: tempDir });
    expect(first.installed.sort()).toEqual([...BUNDLED_SKILLS].sort());
    expect(fs.existsSync(path.join(tempDir, "handoff", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "harness-bridge", "recovery.md"))).toBe(true);

    const second = installSkills({ dir: tempDir });
    expect(second.skipped).toEqual([]);

    const removed = uninstallSkills({ dir: tempDir });
    expect(removed.removed.sort()).toEqual([...BUNDLED_SKILLS].sort());
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it("never overwrites a different skill with the same name unless forced", () => {
    const foreign = path.join(tempDir, "handoff");
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, "SKILL.md"), "---\nname: handoff\ndescription: someone else's\n---\n", "utf8");

    const result = installSkills({ dir: tempDir });
    expect(result.skipped).toEqual(["handoff"]);
    expect(fs.readFileSync(path.join(foreign, "SKILL.md"), "utf8")).toContain("someone else's");

    expect(uninstallSkills({ dir: tempDir }).skipped).toEqual(["handoff"]);
    expect(fs.existsSync(foreign)).toBe(true);

    installSkills({ dir: tempDir, force: true });
    expect(fs.readFileSync(path.join(foreign, "SKILL.md"), "utf8")).toContain("Harness Bridge");
  });
});
