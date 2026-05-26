import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRIDGE_RELATIVE_PATH,
  checkpointBridge,
  getStatus,
  initBridge,
  parseBridge,
  readBridge,
  renderBridge,
  summarizeForConsume,
  validateBridge
} from "../src/core/bridge.js";

let tempDir: string;

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: tempDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bridge-test-"));
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Harness Test"]);
  fs.writeFileSync(path.join(tempDir, "README.md"), "# Fixture\n", "utf8");
  git(["add", "README.md"]);
  git(["commit", "-m", "initial"]);
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("bridge core", () => {
  it("validates shipped example bridges", () => {
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const examples = [
      "examples/01-feature-midway/bridge.md",
      "examples/02-bugfix-handoff/bridge.md",
      "examples/03-refactor-resume/bridge.md"
    ];

    for (const example of examples) {
      const markdown = fs.readFileSync(path.join(repoRoot, example), "utf8");
      expect(validateBridge(markdown), example).toMatchObject({ valid: true, errors: [] });
    }
  });

  it("initializes a schema-valid bridge from git state", () => {
    const doc = initBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      title: "Test handoff",
      goal: "Make the test fixture resumable across agents.",
      nextAction: "Edit README.md and checkpoint the change."
    });

    const file = path.join(tempDir, BRIDGE_RELATIVE_PATH);
    expect(fs.existsSync(file)).toBe(true);
    expect(doc.frontmatter.repo).toBe(path.basename(tempDir));
    expect(validateBridge(fs.readFileSync(file, "utf8")).valid).toBe(true);
  });

  it("checkpoints mutable sections while appending decisions", () => {
    initBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      title: "Test handoff",
      goal: "Make the test fixture resumable across agents."
    });

    const updated = checkpointBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      plan: "- [x] Initialize bridge\n- [~] **Wire tests** — fixture is ready\n- [ ] Verify package",
      nextAction: "Run npm test.",
      decisionsToAppend: ["**Use npm package** — broadest provider install fit."],
      filesTouched: "- `package.json` — new package metadata"
    });

    expect(updated.sections.Plan).toContain("[~]");
    expect(updated.sections["Next action"]).toBe("Run npm test.");
    expect(updated.sections["Decisions & rationale"]).toContain("Use npm package");
    expect(validateBridge(renderBridge(updated)).valid).toBe(true);
  });

  it("reports git discrepancies after files change", () => {
    initBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      title: "Test handoff",
      goal: "Make the test fixture resumable across agents."
    });
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Changed\n", "utf8");

    const status = getStatus(tempDir);
    expect(status.exists).toBe(true);
    expect(status.discrepancies.some((item) => item.startsWith("dirty:"))).toBe(true);
  });

  it("produces consume text with the explicit confirmation gate", () => {
    initBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      title: "Test handoff",
      goal: "Make the test fixture resumable across agents.",
      nextAction: "Run npm test."
    });

    const summary = summarizeForConsume(tempDir);
    expect(summary).toContain("Run npm test.");
    expect(summary).toContain("wait for explicit user confirmation");
  });

  it("grounds consume output in files touched", () => {
    initBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      title: "Test handoff",
      goal: "Make the test fixture resumable across agents.",
      nextAction: "Run npm test."
    });
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Changed\n", "utf8");

    checkpointBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      filesTouched: "- `README.md` — changed fixture readme",
      nextAction: "Review README.md."
    });

    const summary = summarizeForConsume(tempDir);
    expect(summary).toContain("File grounding:");
    expect(summary).toContain("README.md");
    expect(summary).toContain("diff from bridge head:");
  });

  it("refuses to write credential-shaped content", () => {
    initBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      title: "Test handoff",
      goal: "Make the test fixture resumable across agents."
    });

    expect(() =>
      checkpointBridge({
        cwd: tempDir,
        generatedBy: "vitest",
        nextAction: "Use api_key=super-secret-value"
      })
    ).toThrow(/credential-shaped/);
  });

  it("round-trips unknown frontmatter fields", () => {
    const doc = initBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      title: "Test handoff",
      goal: "Make the test fixture resumable across agents."
    });
    doc.frontmatter.extra_field = "preserve me";
    fs.writeFileSync(path.join(tempDir, BRIDGE_RELATIVE_PATH), renderBridge(doc), "utf8");

    checkpointBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      nextAction: "Run npm test."
    });

    const reread = readBridge(tempDir);
    expect(reread?.frontmatter.extra_field).toBe("preserve me");
    expect(parseBridge(renderBridge(reread!)).frontmatter.extra_field).toBe("preserve me");
  });
});
