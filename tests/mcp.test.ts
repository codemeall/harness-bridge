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
});
