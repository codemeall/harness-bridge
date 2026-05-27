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

describe("vault core", () => {
  let vaultDir: string;

  beforeEach(() => {
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-vault-test-"));
  });

  afterEach(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it("scaffolds a standalone vault in an empty directory", async () => {
    const { initVault, vaultStatus, VAULT_DIRS, VAULT_FILES, VAULT_MARKER_START } = await import(
      "../src/core/vault.js"
    );
    const result = initVault({ cwd: vaultDir, vaultName: "demo" });

    expect(result.scenario).toBe("standalone");
    for (const dir of VAULT_DIRS) {
      expect(fs.existsSync(path.join(vaultDir, dir)), dir).toBe(true);
    }
    for (const rel of Object.values(VAULT_FILES)) {
      expect(fs.existsSync(path.join(vaultDir, rel)), rel).toBe(true);
    }

    const claude = fs.readFileSync(path.join(vaultDir, VAULT_FILES.claudeMd), "utf8");
    expect(claude).toContain("LLM Wiki Agent — Schema (demo)");
    expect(claude).toContain(VAULT_MARKER_START);

    const log = fs.readFileSync(path.join(vaultDir, VAULT_FILES.log), "utf8");
    expect(log).toMatch(/^## \[\d{4}-\d{2}-\d{2}\] schema \| Vault initialized$/m);

    const status = vaultStatus(vaultDir);
    expect(status.state).toBe("complete");
    expect(status.pendingIngests).toEqual([]);
  });

  it("co-locates with an existing project by appending a marker-fenced section", async () => {
    const { initVault, VAULT_MARKER_START, VAULT_MARKER_END } = await import(
      "../src/core/vault.js"
    );
    const hostClaude = "# My Project\n\nProject-specific instructions.\n";
    fs.writeFileSync(path.join(vaultDir, "CLAUDE.md"), hostClaude, "utf8");
    fs.writeFileSync(path.join(vaultDir, "package.json"), "{}", "utf8");
    fs.mkdirSync(path.join(vaultDir, "src"));

    const result = initVault({ cwd: vaultDir, vaultName: "project-vault" });

    expect(result.scenario).toBe("co-located");
    expect(result.appendedFiles).toContain("CLAUDE.md");

    const claude = fs.readFileSync(path.join(vaultDir, "CLAUDE.md"), "utf8");
    expect(claude.startsWith(hostClaude)).toBe(true);
    expect(claude).toContain(VAULT_MARKER_START);
    expect(claude).toContain(VAULT_MARKER_END);
    expect(claude).toContain("LLM Wiki Agent — Schema (project-vault)");
  });

  it("refuses on wiki/ collision without force", async () => {
    const { initVault } = await import("../src/core/vault.js");
    initVault({ cwd: vaultDir, vaultName: "demo" });
    expect(() => initVault({ cwd: vaultDir, vaultName: "demo" })).toThrow(/already exists/);
  });

  it("force is repair-only: passes the wiki/ collision but never overwrites schema or catalogs", async () => {
    const { initVault } = await import("../src/core/vault.js");
    initVault({ cwd: vaultDir, vaultName: "first" });

    // Simulate agent-written content the user would lose if force overwrote.
    const logPath = path.join(vaultDir, "wiki", "log.md");
    fs.appendFileSync(logPath, "\n## [2026-05-27] ingest | precious entry\n- do not lose this\n", "utf8");
    const beforeLog = fs.readFileSync(logPath, "utf8");
    const indexPath = path.join(vaultDir, "wiki", "index.md");
    fs.appendFileSync(indexPath, "\n- [[entities/alice]] — first entity page\n", "utf8");
    const beforeIndex = fs.readFileSync(indexPath, "utf8");

    const result = initVault({ cwd: vaultDir, vaultName: "second", force: true });

    const claude = fs.readFileSync(path.join(vaultDir, "CLAUDE.md"), "utf8");
    expect(claude).toContain("LLM Wiki Agent — Schema (first)");
    expect(claude).not.toContain("LLM Wiki Agent — Schema (second)");
    expect(result.skippedFiles).toEqual(
      expect.arrayContaining(["CLAUDE.md", "AGENTS.md", "wiki/index.md", "wiki/log.md"])
    );
    expect(fs.readFileSync(logPath, "utf8")).toBe(beforeLog);
    expect(fs.readFileSync(indexPath, "utf8")).toBe(beforeIndex);
  });

  it("vaultStatus marks a directory without the vault marker as not-a-vault even with leftover dirs", async () => {
    const { vaultStatus } = await import("../src/core/vault.js");
    fs.mkdirSync(path.join(vaultDir, "wiki"));
    // No CLAUDE.md, no marker → must not report 'complete'.
    const status = vaultStatus(vaultDir);
    expect(status.state).not.toBe("complete");
    expect(status.hasVaultMarker).toBe(false);
  });

  it("vaultStatus surfaces pending ingests from raw/", async () => {
    const { initVault, vaultStatus } = await import("../src/core/vault.js");
    initVault({ cwd: vaultDir, vaultName: "demo" });
    fs.writeFileSync(path.join(vaultDir, "raw", "alpha.md"), "# alpha\n", "utf8");
    fs.writeFileSync(path.join(vaultDir, "raw", "beta.md"), "# beta\n", "utf8");
    fs.writeFileSync(path.join(vaultDir, "wiki", "sources", "alpha.md"), "---\n---\n", "utf8");

    const status = vaultStatus(vaultDir);
    expect(status.pendingIngests).toEqual(["raw/beta.md"]);
  });

  it("vaultStatus reports not-a-vault on a fresh directory", async () => {
    const { vaultStatus } = await import("../src/core/vault.js");
    const status = vaultStatus(vaultDir);
    expect(status.state).toBe("not-a-vault");
    expect(status.hasVaultMarker).toBe(false);
  });

  it("renders the Paired projects table when provided", async () => {
    const { renderVaultClaudeMd } = await import("../src/core/vault.js");
    const md = renderVaultClaudeMd({
      vaultName: "demo",
      pairedProjects: [
        { name: "harness-bridge", path: "../harness-bridge/", purpose: "AI handoff", status: "v1" }
      ]
    });
    expect(md).toContain("| harness-bridge | `../harness-bridge/` | AI handoff | v1 |");
  });
});
