import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkpointBridge, initBridge } from "../src/core/bridge.js";
import { buildRecoveryPackage, writeRecoveryPackage } from "../src/recovery/package.js";
import { readTranscriptSlice } from "../src/recovery/slice.js";
import { listSessions, resolveSession } from "../src/sessions/index.js";
import { ClaudeTranscript, CodexRollout, commitFile, createSandbox, fakeBin, git, setClock, type Sandbox } from "./fixtures/transcripts.js";

let sb: Sandbox;

beforeEach(() => {
  setClock("2026-10-27T10:00:00Z");
  sb = createSandbox();
});

afterEach(() => sb.cleanup());

/** The "Linkzly" scenario: ten tasks, five done, one in progress, then a hard usage limit. */
function linkzlySession(cwd = sb.workspace) {
  const t = new ClaudeTranscript(cwd);
  t.meta("ai-title", { aiTitle: "Linkzly QR export" });
  t.user("Implement QR export for Linkzly links. Acceptance: PNG and SVG, tests pass.");
  for (let i = 1; i <= 10; i += 1) t.taskCreate(String(i), `Task ${i}: step ${i} of QR export`);
  for (let i = 1; i <= 5; i += 1) t.taskUpdate(String(i), "completed");
  t.taskUpdate("6", "in_progress");
  t.tool("Write", { file_path: path.join(cwd, "src/qr/export.ts"), content: "x" }, { content: "File created" });
  t.tool("Edit", { file_path: path.join(cwd, "src/qr/svg.ts"), old_string: "a", new_string: "b" }, { content: "ok" });
  t.tool("Bash", { command: "npm test -- qr" }, { content: "Exit code 1\nFAIL src/qr/svg.test.ts > renders viewBox", isError: true });
  t.text("SVG test fails because viewBox is missing; next I will fix src/qr/svg.ts.");
  t.user("ok continue with task 6");
  t.usageLimit();
  return t;
}

describe("Scenario A + J — hard usage limit, recovery without the source provider", () => {
  it("recovers from persisted artifacts and never invokes the exhausted provider", () => {
    const file = linkzlySession().write(sb.claudeHome);
    const bin = fakeBin(sb.base, ["claude", "codex"]);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin.dir}${path.delimiter}${previousPath}`;
    try {
      const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: path.basename(file, ".jsonl"), to: "codex", envPath: process.env.PATH });
      expect(pkg.collected.end.state).toBe("usage-limit");
      expect(pkg.markdown).toContain("usage limit reached");
      expect(pkg.markdown).toContain("Implement QR export");
      expect(pkg.nativeResume.note).toMatch(/unavailable until/);
      expect(pkg.continuation?.installed).toBe(true);
      expect(pkg.continuation?.argv.slice(0, 3)).toEqual(["codex", "-C", fs.realpathSync(sb.workspace)]);
    } finally {
      process.env.PATH = previousPath;
    }
    expect(fs.existsSync(bin.marker)).toBe(false);
  });

  it("recovers a Codex session for continuation in Claude Code (reverse direction)", () => {
    const rollout = new CodexRollout(sb.workspace).user("Add rate limiting to the API").plan([
      { step: "Write limiter", status: "completed" },
      { step: "Wire middleware", status: "in_progress" }
    ]);
    rollout.command("npm test", 0, "12 passed").error("You've hit your usage limit. Try again at 8:00 PM.");
    const file = rollout.write(sb.codexHome);
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file, to: "claude-code" });
    expect(pkg.session.provider).toBe("codex");
    expect(pkg.collected.end.state).toBe("usage-limit");
    expect(pkg.markdown).toContain("[~] Wire middleware");
    expect(pkg.continuation?.command).toContain("claude");
  });
});

describe("Scenario B — multiple sessions", () => {
  it("lists only this workspace's sessions and recovers exactly the one requested", () => {
    const a = new ClaudeTranscript(sb.workspace).user("Session A: refactor auth").text("done A");
    const b = new ClaudeTranscript(sb.workspace).user("Session B: QR export").usageLimit();
    const other = path.join(sb.base, "projects", "unrelated");
    fs.mkdirSync(other, { recursive: true });
    const c = new ClaudeTranscript(other).user("Session C: unrelated project").text("done C");
    a.write(sb.claudeHome);
    b.write(sb.claudeHome);
    c.write(sb.claudeHome);

    const sessions = listSessions(sb.workspace, { provider: "claude-code" });
    expect(sessions.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(sessions.find((s) => s.id === b.id)?.endState).toBe("usage-limit");
    expect(listSessions(sb.workspace, { provider: "claude-code", all: true }).map((s) => s.id)).toContain(c.id);

    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: a.id });
    expect(pkg.markdown).toContain("Session A");
    expect(pkg.markdown).not.toContain("Session B");
  });

  it("warns when the chosen session was recorded in another workspace", () => {
    const other = path.join(sb.base, "projects", "unrelated");
    fs.mkdirSync(other, { recursive: true });
    const c = new ClaudeTranscript(other).user("unrelated work").text("ok");
    c.write(sb.claudeHome);
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: c.id });
    expect(pkg.limitations[0]).toMatch(/not in this workspace/);
  });

  it("follows continued-in links to the session where work continued", () => {
    const next = new ClaudeTranscript(sb.workspace).user("continuation session work");
    const first = new ClaudeTranscript(sb.workspace).user("first part").meta("continued-in", { continuedInSessionId: next.id, timestamp: "2026-10-27T11:00:00Z" });
    first.write(sb.claudeHome);
    next.write(sb.claudeHome);
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: first.id });
    expect(pkg.session.id).toBe(next.id);
    expect(pkg.followedFrom).toEqual([first.id, next.id]);
  });
});

describe("Scenario C — partially completed tasks", () => {
  it("separates done / in progress / pending and checks files against the repo", () => {
    const t = linkzlySession();
    const file = t.write(sb.claudeHome);
    commitFile(sb.workspace, "src/qr/export.ts", "export {}\n", "feat: qr export", "2026-10-27T10:30:00Z");
    fs.mkdirSync(path.join(sb.workspace, "src/qr"), { recursive: true });
    fs.writeFileSync(path.join(sb.workspace, "src/qr/svg.ts"), "wip\n");

    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file });
    expect(pkg.markdown).toContain("Totals: 5 done · 1 in progress · 4 pending");
    expect(pkg.markdown).toContain("[~] #6 Task 6");
    expect(pkg.markdown).toContain("[ ] #10 Task 10");
    const verdicts = Object.fromEntries(pkg.files.map((f) => [f.path, f.repo]));
    expect(verdicts["src/qr/export.ts"]).toContain("committed since session start");
    expect(verdicts["src/qr/svg.ts"]).toContain("new, untracked");
    expect(pkg.markdown).toMatch(/npm test -- qr` → exit 1/);
    expect(pkg.markdown).toContain("(transcript)");
    expect(pkg.markdown).toContain("(repo)");
  });
});

describe("Scenario D — stale bridge", () => {
  it("detects that the transcript moved past the last checkpoint and lists the gaps", () => {
    initBridge({
      cwd: sb.workspace,
      generatedBy: "vitest",
      title: "QR export",
      goal: "Ship QR export.",
      plan: "- [ ] Task 1: step 1 of QR export\n- [ ] Task 2: step 2 of QR export"
    });
    // Bridge written "before" the session continued.
    const bridgeFile = path.join(sb.workspace, ".harness/bridge.md");
    fs.writeFileSync(bridgeFile, fs.readFileSync(bridgeFile, "utf8").replace(/last_updated: .+/, "last_updated: 2026-10-27T10:00:00Z"));
    const file = linkzlySession().write(sb.claudeHome);

    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file });
    expect(pkg.bridge.stale).toBe(true);
    const notes = pkg.bridge.notes.join("\n");
    expect(notes).toContain("STALE");
    expect(notes).toContain("src/qr/export.ts");
    expect(notes).toMatch(/Marked completed in the transcript but not checked in the bridge Plan/);
    expect(pkg.markdown).toContain("bridge_status: stale");
  });

  it("compares timestamps by instant, not text (bridge written with a +05:30 offset)", () => {
    // Session activity ends 10:01Z. 15:00+05:30 is 09:30Z → stale. 16:00+05:30 is 10:30Z → current.
    const file = new ClaudeTranscript(sb.workspace).user("offset task").text("done").write(sb.claudeHome);
    initBridge({ cwd: sb.workspace, generatedBy: "vitest", title: "t", goal: "g" });
    const bridgeFile = path.join(sb.workspace, ".harness/bridge.md");
    const setUpdated = (value: string) => fs.writeFileSync(bridgeFile, fs.readFileSync(bridgeFile, "utf8").replace(/last_updated: .+/, `last_updated: "${value}"`));
    setUpdated("2026-10-27T15:00:00+05:30");
    expect(buildRecoveryPackage({ cwd: sb.workspace, session: file }).bridge.stale).toBe(true);
    setUpdated("2026-10-27T16:00:00+05:30");
    expect(buildRecoveryPackage({ cwd: sb.workspace, session: file }).bridge.stale).toBe(false);
  });

  it("reports a current bridge as current", () => {
    const file = new ClaudeTranscript(sb.workspace).user("small task").text("done").write(sb.claudeHome);
    setClock("2026-10-27T12:00:00Z");
    initBridge({ cwd: sb.workspace, generatedBy: "vitest", title: "t", goal: "g" });
    checkpointBridge({ cwd: sb.workspace, generatedBy: "vitest", filesTouched: "_(none)_" });
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file });
    expect(pkg.bridge.stale).toBe(false);
  });
});

describe("Scenario E — missing transcript", () => {
  it("reports the limitation instead of inventing history", () => {
    expect(() => buildRecoveryPackage({ cwd: sb.workspace, session: "00000000-0000-4000-8000-000000000000" })).toThrow(/No Claude Code or Codex transcript found/);
    expect(listSessions(sb.workspace)).toEqual([]);
  });

  it("refuses transcript paths outside the provider directories, including via symlink", () => {
    const outside = path.join(sb.base, "elsewhere.jsonl");
    fs.writeFileSync(outside, "{}\n");
    expect(() => resolveSession(outside)).toThrow(/Refusing to read/);
    const link = path.join(sb.claudeHome, "projects", "-x", "link.jsonl");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);
    expect(() => resolveSession(link)).toThrow(/Refusing to read/);
    expect(() => resolveSession("/etc/hosts")).toThrow();
  });

  it("tolerates malformed and truncated lines", () => {
    const t = new ClaudeTranscript(sb.workspace).user("real request").raw("{not json").text("answer");
    const file = t.write(sb.claudeHome, { truncateLastLine: true });
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file });
    expect(pkg.collected.stats.malformed).toBeGreaterThanOrEqual(2);
    expect(pkg.limitations.join(" ")).toMatch(/malformed/);
    expect(pkg.markdown).toContain("real request");
  });
});

describe("Scenario F — large transcript", () => {
  it("stays within the character budget and bounded work", () => {
    const t = new ClaudeTranscript(sb.workspace).user("Big migration: convert all handlers.");
    const bigOutput = "y".repeat(50_000);
    for (let i = 0; i < 1500; i += 1) {
      t.tool("Bash", { command: `npm run build -- --step ${i}` }, { content: bigOutput });
      t.tool("Edit", { file_path: path.join(sb.workspace, `src/handlers/h${i}.ts`), old_string: "a", new_string: "b" }, { content: "ok" });
      if (i % 100 === 0) t.user(`continue with batch ${i}`);
    }
    t.meta("api-request-blob", { message: { content: "z".repeat(5_000_000) } });
    t.usageLimit();
    const file = t.write(sb.claudeHome);
    expect(fs.statSync(file).size).toBeGreaterThan(70 * 1024 * 1024);

    const started = Date.now();
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file, budgetChars: 12000 });
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(pkg.markdown.length).toBeLessThanOrEqual(12000);
    expect(pkg.collected.files.length).toBe(200);
    expect(pkg.collected.end.state).toBe("usage-limit");
    expect(pkg.markdown).not.toContain("yyyyyyyyyy");

    const slice = readTranscriptSlice({ session: file, grep: "batch 1400", maxChars: 2000 });
    expect(slice).toContain("continue with batch 1400");
  }, 60_000);
});

describe("Scenario G — secret redaction", () => {
  it("never copies credential-shaped values into the package or slices", () => {
    const anthropic = "sk-ant-api03-" + "Q".repeat(40);
    const github = "ghp_" + "R7".repeat(20);
    const t = new ClaudeTranscript(sb.workspace)
      .user(`Use this key for testing: ${anthropic}`)
      .tool("Bash", { command: `curl -H "Authorization: Bearer ${"t0k3n".repeat(5)}" https://api.example.com` }, { content: "Exit code 22\nunauthorized", isError: true })
      .tool("Read", { file_path: path.join(sb.workspace, ".env") }, { content: `GITHUB_TOKEN=${github}\nDB_PASSWORD=correcthorsebattery` })
      .meta("api-request-blob", { message: { content: `leaked ${anthropic}` } })
      .text(`I stored ${github} in the config.`);
    const file = t.write(sb.claudeHome);
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file });
    const written = fs.readFileSync(writeRecoveryPackage(sb.workspace, pkg), "utf8");
    const slice = readTranscriptSlice({ session: file, from: 1, to: 999, includeToolOutput: true });
    for (const text of [pkg.markdown, written, slice]) {
      expect(text).not.toContain(anthropic);
      expect(text).not.toContain(github);
      expect(text).not.toContain("t0k3nt0k3n");
      expect(text).not.toContain("correcthorsebattery");
    }
    expect(slice).toContain("[REDACTED");
  });

  it("redacts session titles and prompts in listings", () => {
    const key = "sk-ant-api03-" + "Z".repeat(40);
    new ClaudeTranscript(sb.workspace).user(`Debug auth with ${key}`).usageLimit().write(sb.claudeHome);
    new CodexRollout(sb.workspace).user(`Try ${key} again`).write(sb.codexHome);
    const listed = JSON.stringify(listSessions(sb.workspace));
    expect(listed).not.toContain(key);
    expect(listed).toContain("[REDACTED");
  });

  it("keeps saved packages out of git", () => {
    const file = new ClaudeTranscript(sb.workspace).user("hello world task").write(sb.claudeHome);
    writeRecoveryPackage(sb.workspace, buildRecoveryPackage({ cwd: sb.workspace, session: file }));
    expect(fs.readFileSync(path.join(sb.workspace, ".harness/recovery/.gitignore"), "utf8")).toContain("*");
    expect(git(sb.workspace, ["status", "--porcelain"])).not.toContain("recovery");
  });
});

describe("Scenario H — destination cannot be launched", () => {
  it("still produces the package plus a manual command and prompt", () => {
    const file = linkzlySession().write(sb.claudeHome);
    const empty = fakeBin(sb.base, []);
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file, to: "codex", envPath: empty.dir });
    expect(pkg.continuation?.installed).toBe(false);
    expect(pkg.continuation?.prompt).toContain(".harness/recovery/");
    expect(pkg.markdown).toContain("not found on PATH");
    expect(pkg.markdown).toContain("# Recovery package");
  });

  it("builds an Antigravity continuation run from the workspace", () => {
    const file = linkzlySession().write(sb.claudeHome);
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file, to: "antigravity" });
    expect(pkg.continuation?.argv[0]).toBe("agy");
    expect(pkg.continuation?.argv[1]).toBe("-i");
    expect(pkg.continuation?.command).toMatch(/^cd .+ && agy -i /);
  });
});

describe("Claude transcript noise handling", () => {
  it("skips sidechains, meta records and request blobs, and dedupes re-sent prompts", () => {
    const t = new ClaudeTranscript(sb.workspace)
      .user("<command-name>/clear</command-name><command-args></command-args>")
      .user("Build the dashboard")
      .user("Build the dashboard")
      .sidechain("subagent private prompt")
      .user("<system-reminder>internal</system-reminder>", { isMeta: true })
      .meta("api-request", { params: { messages: [{ content: "Build the dashboard" }] } })
      .compact("Summary: the dashboard uses React and Vite.")
      .text("Working on it");
    const file = t.write(sb.claudeHome);
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: file });
    expect(pkg.session.title).toBe("Build the dashboard");
    expect(pkg.collected.goal.map((g) => g.text)).toEqual(["Build the dashboard"]);
    expect(pkg.markdown).not.toContain("subagent private prompt");
    expect(pkg.markdown).toContain("dashboard uses React and Vite");
    expect(pkg.collected.stats.skippedSidechain).toBe(1);
  });
});

describe("Codex rollouts", () => {
  it.each(["items", "legacy"] as const)("parses the %s layout", (layout) => {
    const r = new CodexRollout(sb.workspace, layout)
      .user("Fix custom event paging")
      .plan([
        { step: "Find the bug", status: "completed" },
        { step: "Patch the query", status: "in_progress" }
      ])
      .patch([{ path: "src/paging.ts", op: "update" }])
      .command("npm test", 1, "1 failed")
      .agent("The paging test still fails.")
      .aborted();
    const file = r.write(sb.codexHome);
    const [summary] = listSessions(sb.workspace, { provider: "codex" });
    expect(summary.id).toBe(r.id);
    expect(summary.endState).toBe("interrupted");
    const pkg = buildRecoveryPackage({ cwd: sb.workspace, session: r.id, provider: "codex" });
    expect(pkg.collected.goal[0].text).toBe("Fix custom event paging");
    expect(pkg.markdown).not.toContain("environment_context");
    expect(pkg.files.map((f) => f.path)).toEqual(["src/paging.ts"]);
    expect(pkg.markdown).toMatch(/`npm test` → exit 1/);
    expect(pkg.markdown).toContain("[x] Find the bug");
    expect(pkg.nativeResume.command).toBe(`codex resume ${r.id}`);
    expect(file).toContain(r.id);
  });
});
