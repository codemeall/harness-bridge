import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ClaudeTranscript, createSandbox, fakeBin, setClock, type Sandbox } from "./fixtures/transcripts.js";

const CLI = path.resolve(import.meta.dirname, "../dist/cli.js");
let sb: Sandbox;

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: sb.workspace,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: sb.claudeHome, CODEX_HOME: sb.codexHome, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

beforeAll(() => {
  if (!fs.existsSync(CLI)) throw new Error("Run `npm run build` before the CLI tests (npm test does this).");
});
beforeEach(() => {
  setClock("2026-10-27T10:00:00Z");
  sb = createSandbox();
});
afterEach(() => sb.cleanup());

describe("cli", () => {
  it("lists sessions and refuses to guess which one to recover", () => {
    new ClaudeTranscript(sb.workspace).user("first task").text("ok").write(sb.claudeHome);
    new ClaudeTranscript(sb.workspace).user("second task").usageLimit().write(sb.claudeHome);
    const list = run(["sessions"]);
    expect(list.code).toBe(0);
    expect(list.out).toContain("⚠ usage limit");
    const recover = run(["recover"]);
    expect(recover.code).toBe(2);
    expect(recover.err).toContain("Recovery never guesses");
    expect(fs.existsSync(path.join(sb.workspace, ".harness"))).toBe(false);
  });

  it("recovers with --to codex --write and prints the continuation command", () => {
    const t = new ClaudeTranscript(sb.workspace).user("Ship the importer").usageLimit();
    t.write(sb.claudeHome);
    const bin = fakeBin(sb.base, ["codex"]);
    const result = run(["recover", t.id, "--to", "codex"], { PATH: `${bin.dir}${path.delimiter}${process.env.PATH}` });
    expect(result.code).toBe(0);
    expect(result.err).toContain("Recovery package written to");
    expect(result.err).toMatch(/Continue in Codex: codex -C .+ 'Continue the work/);
    expect(result.err).toContain("claude --resume");
    expect(fs.existsSync(bin.marker)).toBe(false);
  });

  it("falls back to manual instructions when the destination is missing", () => {
    const t = new ClaudeTranscript(sb.workspace).user("Ship the importer").usageLimit();
    t.write(sb.claudeHome);
    const gitDir = path.dirname(spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim());
    const result = run(["recover", t.id, "--to", "codex"], { PATH: gitDir });
    expect(result.code).toBe(0);
    expect(result.err).toContain("was not found on PATH");
    expect(result.err).toContain("paste this prompt");
  });

  it("redacts secrets in session listings (text and JSON)", () => {
    const key = "ghp_" + "K9".repeat(20);
    new ClaudeTranscript(sb.workspace).user(`token is ${key}`).write(sb.claudeHome);
    expect(run(["sessions"]).out).not.toContain(key);
    expect(run(["sessions", "--json"]).out).not.toContain(key);
  });

  it("reads bounded transcript slices and validates arguments", () => {
    const t = new ClaudeTranscript(sb.workspace).user("alpha").user("beta").user("gamma");
    t.write(sb.claudeHome);
    const slice = run(["transcript", t.id, "--grep", "beta"]);
    expect(slice.out).toContain("[user] beta");
    expect(slice.out).not.toContain("gamma");
    const range = run(["transcript", t.id, "--from", "1", "--until", "2"]);
    expect(range.out).toContain("[user] alpha");
    expect(range.out).not.toContain("gamma");
    expect(run(["transcript", t.id, "--around", "nope"]).code).toBe(2);
    expect(run(["frobnicate"]).code).toBe(2);
    const help = run(["recover", "--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("harness-bridge recover");
  });

  it("keeps the original bridge commands working", () => {
    expect(run(["init", "--title", "CLI", "--goal", "Check compatibility.", "--rules", "claude", "--rules", "codex"]).code).toBe(0);
    expect(fs.readFileSync(path.join(sb.workspace, "AGENTS.md"), "utf8")).toContain("## Harness Bridge — keep .harness/bridge.md current");
    expect(fs.existsSync(path.join(sb.workspace, "CLAUDE.md"))).toBe(true);
    expect(run(["init", "--title", "x", "--goal", "y", "--rules", "nope"]).code).toBe(2);
    expect(run(["checkpoint", "--next-action=Run the tests", "--decision", "Keep CLI flags"]).out).toContain("Keep CLI flags");
    expect(run(["validate"]).out).toContain('"valid": true');
    expect(run(["consume"]).out).toContain("Run the tests");
  });
});
