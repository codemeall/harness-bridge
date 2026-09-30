import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRIDGE_RELATIVE_PATH,
  checkpointBridge,
  excludeBridgeFromGit,
  findSecrets,
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

  it("renders optional handoff sections only when they have content, and clears them", () => {
    initBridge({ cwd: tempDir, generatedBy: "vitest", title: "Test handoff", goal: "Make the fixture resumable." });

    const withExtras = checkpointBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      focus: "Write the integration test against real Redis.",
      references: "- `docs/adr/0003-rate-limit.md` — why token bucket",
      suggestedSkills: "- tdd — next step starts with a failing test"
    });
    const markdown = renderBridge(withExtras);
    expect(validateBridge(markdown)).toMatchObject({ valid: true, errors: [] });
    expect(markdown.indexOf("## Goal")).toBeLessThan(markdown.indexOf("## Next session focus"));
    expect(markdown.indexOf("## Next session focus")).toBeLessThan(markdown.indexOf("## Plan"));
    expect(markdown.indexOf("## Files touched")).toBeLessThan(markdown.indexOf("## References"));
    expect(markdown.indexOf("## Suggested skills")).toBeLessThan(markdown.indexOf("## Notes for the next agent"));

    const cleared = checkpointBridge({ cwd: tempDir, generatedBy: "vitest", focus: "" });
    const clearedMarkdown = renderBridge(cleared);
    expect(clearedMarkdown).not.toContain("## Next session focus");
    expect(clearedMarkdown).toContain("## References");
  });

  it("does not render empty optional sections on a fresh bridge", () => {
    const doc = initBridge({ cwd: tempDir, generatedBy: "vitest", title: "Test handoff", goal: "Make the fixture resumable." });
    const markdown = renderBridge(doc);
    expect(markdown).not.toContain("## Next session focus");
    expect(markdown).not.toContain("## References");
    expect(markdown).not.toContain("## Suggested skills");
    expect(markdown).toContain("## Notes for the next agent");
  });

  it("preserves sections it does not recognize", () => {
    const doc = initBridge({ cwd: tempDir, generatedBy: "vitest", title: "Test handoff", goal: "Make the fixture resumable." });
    const withCustom = `${renderBridge(doc)}\n## Team conventions\nKeep PRs under 400 lines.\n`;
    fs.writeFileSync(path.join(tempDir, BRIDGE_RELATIVE_PATH), withCustom, "utf8");

    checkpointBridge({ cwd: tempDir, generatedBy: "vitest", nextAction: "Run npm test." });

    const reread = fs.readFileSync(path.join(tempDir, BRIDGE_RELATIVE_PATH), "utf8");
    expect(reread).toContain("## Team conventions\nKeep PRs under 400 lines.");
    expect(validateBridge(reread).valid).toBe(true);
  });

  it("includes focus, decisions, references, and suggested skills in consume output", () => {
    initBridge({ cwd: tempDir, generatedBy: "vitest", title: "Test handoff", goal: "Make the fixture resumable." });
    checkpointBridge({
      cwd: tempDir,
      generatedBy: "vitest",
      nextAction: "Run npm test.",
      decisionsToAppend: ["**Token bucket over fixed window** — smoother bursts."],
      focus: "Only the Redis integration test.",
      references: "- https://example.com/issues/42",
      suggestedSkills: "- tdd — start from a failing test"
    });

    const summary = summarizeForConsume(tempDir);
    expect(summary).toContain("Next session focus:\nOnly the Redis integration test.");
    expect(summary).toContain("Token bucket over fixed window");
    expect(summary).toContain("https://example.com/issues/42");
    expect(summary).toContain("- tdd — start from a failing test");
    expect(summary).toContain("Load the suggested skills");
  });

  it("detects common credential formats without flagging ordinary text", () => {
    expect(findSecrets(`GH token ghp_${"a".repeat(36)}`)).toContain("GitHub token");
    expect(findSecrets("DATABASE_URL=postgres://app:hunter22@db:5432/app")).toContain("URL credentials");
    expect(findSecrets("AKIAABCDEFGHIJKLMNOP")).toContain("AWS access key");
    expect(findSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123")).toContain("bearer token");
    expect(findSecrets("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toContain("private key");

    expect(findSecrets("Set max_tokens: 1024 and use a token-bucket limiter.")).toEqual([]);
    expect(findSecrets("password: ${DB_PASSWORD}; apiKey = process.env.API_KEY; token: <from vault>")).toEqual([]);
  });

  it("keeps the bridge local-only via .git/info/exclude", () => {
    initBridge({ cwd: tempDir, generatedBy: "vitest", title: "Test handoff", goal: "Make the fixture resumable." });
    expect(getStatus(tempDir).ignoredByGit).toBe(false);

    const excludeFile = excludeBridgeFromGit(tempDir);
    excludeBridgeFromGit(tempDir);

    expect(fs.readFileSync(excludeFile, "utf8").match(/^\/\.harness\/$/gm)).toHaveLength(1);
    expect(getStatus(tempDir).ignoredByGit).toBe(true);
    expect(git(["status", "--porcelain"])).not.toContain(".harness");
  });
});
