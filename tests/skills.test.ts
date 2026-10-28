import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateBridge } from "../src/core/bridge.js";
import { execFileSync } from "node:child_process";
import {
  BUNDLED_SKILLS,
  SKILL_MANIFEST,
  bundledSkillsDir,
  detectSkillAgents,
  installSkills,
  parseSkillAgent,
  resolveSkillsTarget,
  skillStatus,
  skillTreeHash,
  uninstallSkills,
  withoutDuplicateTargets
} from "../src/core/skills.js";
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
    // Codex docs (also covering the ChatGPT desktop app) use ~/.agents/skills.
    expect(resolveSkillsTarget({ agent: "codex", homeDir: "/home/u" })).toBe(path.join("/home/u", ".agents/skills"));
    expect(resolveSkillsTarget({ agent: "opencode", homeDir: "/home/u" })).toBe(path.join("/home/u", ".config/opencode/skills"));
    expect(resolveSkillsTarget({ agent: "antigravity", homeDir: "/home/u" })).toBe(path.join("/home/u", ".gemini/config/skills"));
    expect(resolveSkillsTarget({ agent: "antigravity-cli", homeDir: "/home/u" })).toBe(path.join("/home/u", ".gemini/antigravity-cli/skills"));
    expect(resolveSkillsTarget({ agent: "opencode", scope: "project", cwd: "/repo" })).toBe(path.join("/repo", ".agents/skills"));
    expect(parseSkillAgent("chatgpt")).toBe("codex");
    expect(parseSkillAgent("agy")).toBe("antigravity-cli");
    expect(() => parseSkillAgent("nope")).toThrow(/Unknown agent/);
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

  it("updates copies it installed, but never local edits or another installer's symlinks", () => {
    installSkills({ dir: tempDir });
    expect(skillStatus(tempDir, "pickup").state).toBe("current");

    // Simulate an older release this tool installed: different content, matching manifest hash.
    const pickup = path.join(tempDir, "pickup");
    fs.writeFileSync(path.join(pickup, "SKILL.md"), "---\nname: pickup\ndescription: old Harness Bridge pickup\n---\n");
    fs.writeFileSync(path.join(pickup, SKILL_MANIFEST), JSON.stringify({ package: "@codemeall/harness-bridge", version: "0.0.1", hash: skillTreeHash(pickup) }));
    expect(skillStatus(tempDir, "pickup")).toMatchObject({ state: "outdated", installedVersion: "0.0.1" });

    // A locally edited copy.
    fs.appendFileSync(path.join(tempDir, "handoff", "SKILL.md"), "\nMy own note.\n");
    expect(skillStatus(tempDir, "handoff").state).toBe("modified");

    // A copy managed by `npx skills` (symlink into ~/.agents/skills).
    const shared = path.join(tempDir, "shared-recover");
    fs.cpSync(path.join(bundledSkillsDir(), "recover-session"), shared, { recursive: true });
    fs.appendFileSync(path.join(shared, "SKILL.md"), "\n<!-- older -->\n");
    fs.rmSync(path.join(tempDir, "recover-session"), { recursive: true });
    fs.symlinkSync(shared, path.join(tempDir, "recover-session"));
    expect(skillStatus(tempDir, "recover-session").state).toBe("external");

    const result = installSkills({ dir: tempDir });
    expect(result.updated).toEqual(["pickup"]);
    expect(result.skipped.sort()).toEqual(["handoff", "recover-session"]);
    expect(result.reasons["recover-session"]).toMatch(/npx skills/);
    expect(fs.readFileSync(path.join(pickup, "SKILL.md"), "utf8")).toBe(fs.readFileSync(path.join(bundledSkillsDir(), "pickup", "SKILL.md"), "utf8"));
    expect(fs.readFileSync(path.join(tempDir, "handoff", "SKILL.md"), "utf8")).toContain("My own note.");

    const removed = uninstallSkills({ dir: tempDir });
    expect(removed.skipped).toEqual(["recover-session"]);
    expect(fs.existsSync(shared)).toBe(true);
  });

  it("recognises untouched 0.3.0 installs (no manifest) as outdated", () => {
    let archive: Buffer;
    try {
      archive = execFileSync("git", ["archive", "19de2c1", "skills/pickup"], { cwd: repoRoot });
    } catch {
      return; // history not available (e.g. shallow clone)
    }
    execFileSync("tar", ["-x", "-C", tempDir], { input: archive });
    const target = path.join(tempDir, "skills");
    expect(skillStatus(target, "pickup")).toMatchObject({ state: "outdated", installedVersion: "0.3.0" });
    expect(installSkills({ dir: target }).updated).toContain("pickup");
  });

  it("skips Cursor and OpenCode global folders when Claude Code or Codex already covers them", () => {
    expect(withoutDuplicateTargets(["claude-code", "opencode", "cursor", "antigravity-cli"])).toEqual({
      agents: ["claude-code", "antigravity-cli"],
      covered: ["opencode", "cursor"]
    });
    expect(withoutDuplicateTargets(["opencode"]).agents).toEqual(["opencode"]);
  });

  it("detects installed agents from their config folders", () => {
    for (const dir of [".claude", ".agents", ".config/opencode", ".gemini/antigravity-cli"]) fs.mkdirSync(path.join(tempDir, dir), { recursive: true });
    expect(detectSkillAgents(tempDir)).toEqual(["claude-code", "codex", "opencode", "antigravity-cli"]);
  });
});

describe("templates", () => {
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

  it("keeps the provider snippets in sync", () => {
    const body = (rel: string) => read(rel).split("\n").slice(1).join("\n");
    const canonical = body("templates/codex/AGENTS.md.snippet");
    for (const rel of ["templates/gemini/GEMINI.md.snippet", "templates/cursor/harness-bridge-rule.md", "templates/antigravity/AGENTS.md.snippet"]) {
      expect(body(rel), rel).toBe(canonical);
    }
  });

  it("keeps the maintainer snippet header and template intact", () => {
    const maintainer = read("prompts/maintainer.md");
    expect(maintainer.match(/## Harness Bridge — keep \.harness\/bridge\.md current/g)).toHaveLength(2);
    expect(maintainer).toContain("schema: harness-bridge/v1");
    expect(maintainer).toContain("Legend: [x] done · [~] in progress · [ ] pending");
  });
});
