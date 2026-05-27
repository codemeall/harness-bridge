#!/usr/bin/env node
import fs from "node:fs";
import { checkpointBridge, getStatus, initBridge, renderBridge, summarizeForConsume, validateBridge } from "./core/bridge.js";
import { initVault, vaultStatus } from "./core/vault.js";
import { runMcpServer } from "./mcp/server.js";

function usage(): never {
  console.error(`Usage:
  harness-bridge mcp
  harness-bridge status
  harness-bridge validate [bridge.md]
  harness-bridge consume
  harness-bridge init --title <title> --goal <goal>
  harness-bridge checkpoint [--next-action <text>] [--plan <markdown>]
  harness-bridge vault-init --name <vaultName> [--domain <domain>] [--force]
  harness-bridge vault-status
`);
  process.exit(2);
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) usage();

  if (command === "mcp") {
    await runMcpServer(process.cwd());
    return;
  }

  if (command === "status") {
    console.log(JSON.stringify(getStatus(process.cwd()), null, 2));
    return;
  }

  if (command === "validate") {
    const markdown = args[0] ? fs.readFileSync(args[0], "utf8") : fs.readFileSync(".harness/bridge.md", "utf8");
    console.log(JSON.stringify(validateBridge(markdown), null, 2));
    return;
  }

  if (command === "consume") {
    console.log(summarizeForConsume(process.cwd()));
    return;
  }

  if (command === "init") {
    const title = readFlag(args, "--title");
    const goal = readFlag(args, "--goal");
    if (!title || !goal) usage();
    const plan = readFlag(args, "--plan");
    const nextAction = readFlag(args, "--next-action");
    const doc = initBridge({
      cwd: process.cwd(),
      generatedBy: "cli:harness-bridge",
      title,
      goal,
      plan,
      nextAction
    });
    console.log(renderBridge(doc));
    return;
  }

  if (command === "checkpoint") {
    const doc = checkpointBridge({
      cwd: process.cwd(),
      generatedBy: "cli:harness-bridge",
      title: readFlag(args, "--title"),
      goal: readFlag(args, "--goal"),
      plan: readFlag(args, "--plan"),
      nextAction: readFlag(args, "--next-action"),
      openQuestions: readFlag(args, "--open-questions"),
      filesTouched: readFlag(args, "--files-touched"),
      notes: readFlag(args, "--notes")
    });
    console.log(renderBridge(doc));
    return;
  }

  if (command === "vault-init") {
    const name = readFlag(args, "--name");
    if (!name) usage();
    const domain = readFlag(args, "--domain");
    const force = args.includes("--force");
    const result = initVault({
      cwd: process.cwd(),
      vaultName: name,
      domain,
      force
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "vault-status") {
    console.log(JSON.stringify(vaultStatus(process.cwd()), null, 2));
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
