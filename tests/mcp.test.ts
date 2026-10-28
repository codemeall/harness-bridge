import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRIDGE_RELATIVE_PATH } from "../src/core/bridge.js";
import { PACKAGE_VERSION } from "../src/core/version.js";
import { createHarnessBridgeServer } from "../src/mcp/server.js";
import { ClaudeTranscript, createSandbox, setClock } from "./fixtures/transcripts.js";

let serverCwd: string;
let targetCwd: string;

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function setupGitRepo(prefix: string): string {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(cwd, ["init"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Harness Test"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "# Fixture\n", "utf8");
  git(cwd, ["add", "README.md"]);
  git(cwd, ["commit", "-m", "initial"]);
  return cwd;
}

async function connectClient(defaultCwd = serverCwd) {
  const server = createHarnessBridgeServer(defaultCwd);
  const client = new Client({ name: "harness-bridge-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error("Expected text tool response.");
  }
  return first.text;
}

async function initTargetBridge(client: Client) {
  return client.callTool({
    name: "bridge_init",
    arguments: {
      cwd: targetCwd,
      title: "MCP test handoff",
      goal: "Verify MCP bridge tool behavior.",
      nextAction: "Run the next MCP assertion."
    }
  });
}

beforeEach(() => {
  serverCwd = setupGitRepo("harness-bridge-mcp-server-");
  targetCwd = setupGitRepo("harness-bridge-mcp-target-");
});

afterEach(() => {
  fs.rmSync(serverCwd, { recursive: true, force: true });
  fs.rmSync(targetCwd, { recursive: true, force: true });
});

describe("mcp server", () => {
  it("reports the package version in MCP server metadata", async () => {
    const { client, server } = await connectClient();

    expect(client.getServerVersion()).toMatchObject({
      name: "harness-bridge",
      version: PACKAGE_VERSION
    });

    await client.close();
    await server.close();
  });

  it("honors explicit cwd and reports the written bridge path", async () => {
    const { client, server } = await connectClient(serverCwd);
    const result = await initTargetBridge(client);
    const text = textContent(result);
    const targetBridge = path.join(targetCwd, BRIDGE_RELATIVE_PATH);
    const serverBridge = path.join(serverCwd, BRIDGE_RELATIVE_PATH);

    expect(text).toContain(`Initialized bridge at ${targetBridge}`);
    expect(fs.existsSync(targetBridge)).toBe(true);
    expect(fs.existsSync(serverBridge)).toBe(false);

    await client.close();
    await server.close();
  });

  it("rejects empty bridge_produce calls without explicit no-change confirmation", async () => {
    const { client, server } = await connectClient();
    await initTargetBridge(client);

    const result = await client.callTool({
      name: "bridge_produce",
      arguments: { cwd: targetCwd }
    });

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("bridge_produce requires handoff content");

    await client.close();
    await server.close();
  });

  it("accepts bridge_produce confirmNoChanges and reports the written bridge path", async () => {
    const { client, server } = await connectClient();
    await initTargetBridge(client);

    const result = await client.callTool({
      name: "bridge_produce",
      arguments: {
        cwd: targetCwd,
        confirmNoChanges: true
      }
    });

    expect(result.isError).not.toBe(true);
    expect(textContent(result)).toContain(`Produced handoff bridge at ${path.join(targetCwd, BRIDGE_RELATIVE_PATH)}`);

    await client.close();
    await server.close();
  });

  it("accepts bridge_produce handoff content and writes it to the explicit cwd", async () => {
    const { client, server } = await connectClient();
    await initTargetBridge(client);

    const nextAction = "Open src/main.ts and implement the first Todo action.";
    const result = await client.callTool({
      name: "bridge_produce",
      arguments: {
        cwd: targetCwd,
        nextAction,
        filesTouched: "- `src/main.ts` — planned first implementation target"
      }
    });

    const bridgeMarkdown = fs.readFileSync(path.join(targetCwd, BRIDGE_RELATIVE_PATH), "utf8");
    expect(result.isError).not.toBe(true);
    expect(textContent(result)).toContain(`Produced handoff bridge at ${path.join(targetCwd, BRIDGE_RELATIVE_PATH)}`);
    expect(bridgeMarkdown).toContain(nextAction);
    expect(fs.existsSync(path.join(serverCwd, BRIDGE_RELATIVE_PATH))).toBe(false);

    await client.close();
    await server.close();
  });

  it("writes focus, references, and suggested skills from bridge_produce", async () => {
    const { client, server } = await connectClient();
    await initTargetBridge(client);

    const result = await client.callTool({
      name: "bridge_produce",
      arguments: {
        cwd: targetCwd,
        focus: "Ship the retry path.",
        references: "- `docs/spec.md` — retry semantics",
        suggestedSkills: "- tdd — start from a failing test"
      }
    });

    const bridgeMarkdown = fs.readFileSync(path.join(targetCwd, BRIDGE_RELATIVE_PATH), "utf8");
    expect(result.isError).not.toBe(true);
    expect(textContent(result)).toContain("/pickup");
    expect(bridgeMarkdown).toContain("## Next session focus\nShip the retry path.");
    expect(bridgeMarkdown).toContain("## References\n- `docs/spec.md` — retry semantics");
    expect(bridgeMarkdown).toContain("## Suggested skills\n- tdd — start from a failing test");

    await client.close();
    await server.close();
  });

  it("keeps every v0.2 tool and adds the session tools (Scenario I)", async () => {
    const { client, server } = await connectClient();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of ["bridge_status", "bridge_validate", "bridge_init", "bridge_checkpoint", "bridge_produce", "bridge_consume", "bridge_recover"]) {
      expect(names).toContain(name);
    }
    for (const name of ["session_list", "session_recover", "session_read", "session_destinations"]) expect(names).toContain(name);
    const prompts = (await client.listPrompts()).prompts.map((prompt) => prompt.name);
    expect(prompts).toContain("bridge_recover_prompt");
    await client.close();
    await server.close();
  });

  it("reports an existing bridge instead of claiming to initialize it", async () => {
    const { client, server } = await connectClient();
    await initTargetBridge(client);
    const again = textContent(await initTargetBridge(client));
    expect(again).toContain("already exists");
    await client.close();
    await server.close();
  });

  it("keeps the bridge out of git when bridge_init is called with localOnly", async () => {
    const { client, server } = await connectClient();
    const result = await client.callTool({
      name: "bridge_init",
      arguments: { cwd: targetCwd, title: "Local", goal: "Keep handoffs out of commits.", localOnly: true }
    });

    expect(textContent(result)).toContain("local-only");
    expect(git(targetCwd, ["status", "--porcelain"])).not.toContain(".harness");

    await client.close();
    await server.close();
  });

  it("installs maintainer rules for several providers in one bridge_init call, idempotently", async () => {
    const { client, server } = await connectClient();
    const args = { cwd: targetCwd, title: "Rules", goal: "Install rules.", installInstructionsFor: ["claude-code", "codex"] };
    await client.callTool({ name: "bridge_init", arguments: args });
    const again = textContent(await client.callTool({ name: "bridge_init", arguments: args }));
    expect(again).toContain("already contains Harness Bridge instructions");
    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      const text = fs.readFileSync(path.join(targetCwd, file), "utf8");
      expect(text.match(/## Harness Bridge — keep \.harness\/bridge\.md current/g)).toHaveLength(1);
    }
    const single = await client.callTool({ name: "bridge_init", arguments: { ...args, installInstructionsFor: "cursor" } });
    expect(single.isError).not.toBe(true);
    expect(fs.existsSync(path.join(targetCwd, ".cursor/rules/harness-bridge.md"))).toBe(true);
    await client.close();
    await server.close();
  });

  it("rejects a cwd that does not exist", async () => {
    const { client, server } = await connectClient();
    const result = await client.callTool({ name: "bridge_status", arguments: { cwd: path.join(targetCwd, "missing") } });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("does not exist");
    await client.close();
    await server.close();
  });

  it("still validates and writes agent-supplied recovered bridges via bridge_recover", async () => {
    const { client, server } = await connectClient();
    await initTargetBridge(client);
    const markdown = fs.readFileSync(path.join(targetCwd, BRIDGE_RELATIVE_PATH), "utf8").replace("Run the next MCP assertion.", "Recovered next action.");
    const preview = JSON.parse(textContent(await client.callTool({ name: "bridge_recover", arguments: { cwd: targetCwd, mode: "since", recoveredBridgeMarkdown: markdown } })));
    expect(preview.written).toBe(false);
    const written = JSON.parse(textContent(await client.callTool({ name: "bridge_recover", arguments: { cwd: targetCwd, mode: "since", recoveredBridgeMarkdown: markdown, write: true } })));
    expect(written.written).toBe(true);
    expect(fs.readFileSync(path.join(targetCwd, BRIDGE_RELATIVE_PATH), "utf8")).toContain("Recovered next action.");
    await client.close();
    await server.close();
  });

  it("lists, recovers and reads a session through MCP", async () => {
    setClock("2026-10-27T10:00:00Z");
    const sb = createSandbox();
    try {
      const t = new ClaudeTranscript(sb.workspace).user("Add CSV import to the dashboard").taskCreate("1", "Parse CSV").usageLimit();
      t.write(sb.claudeHome);
      const { client, server } = await connectClient(sb.workspace);

      const list = JSON.parse(textContent(await client.callTool({ name: "session_list", arguments: { cwd: sb.workspace } })));
      expect(list.sessions).toHaveLength(1);
      expect(list.sessions[0]).toMatchObject({ id: t.id, endState: "usage-limit", workspaceMatch: "exact" });

      const missing = await client.callTool({ name: "session_recover", arguments: { cwd: sb.workspace } });
      expect(missing.isError).toBe(true);

      const recovered = textContent(await client.callTool({ name: "session_recover", arguments: { cwd: sb.workspace, session: t.id, to: "codex", write: true } }));
      expect(recovered).toContain("Add CSV import");
      expect(recovered).toContain("Continue in Codex");
      expect(fs.existsSync(path.join(sb.workspace, ".harness/recovery", `claude-code-${t.id.slice(0, 8)}.md`))).toBe(true);
      expect(fs.existsSync(path.join(sb.workspace, BRIDGE_RELATIVE_PATH))).toBe(false);

      const slice = textContent(await client.callTool({ name: "session_read", arguments: { session: t.id, grep: "CSV" } }));
      expect(slice).toContain("[user] Add CSV import");

      const history = JSON.parse(textContent(await client.callTool({ name: "session_list", arguments: { cwd: sb.workspace } })));
      expect(history.previousRecoveries[0].session).toBe(t.id);
      await client.close();
      await server.close();
    } finally {
      sb.cleanup();
    }
  });
});

