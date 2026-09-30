#!/usr/bin/env node
import fs from "node:fs";
import {
  checkpointBridge,
  excludeBridgeFromGit,
  getStatus,
  initBridge,
  renderBridge,
  summarizeForConsume,
  validateBridge
} from "./core/bridge.js";
import { SKILL_AGENTS, installSkills, uninstallSkills, type SkillAgent, type SkillInstallOptions } from "./core/skills.js";
import { runMcpServer } from "./mcp/server.js";

function usage(): never {
  console.error(`Usage:
  harness-bridge mcp
  harness-bridge status
  harness-bridge validate [bridge.md]
  harness-bridge consume
  harness-bridge init --title <title> --goal <goal> [--local]
  harness-bridge checkpoint [--next-action <text>] [--plan <markdown>] [--focus <text>]
                            [--references <markdown>] [--suggested-skills <markdown>]
  harness-bridge install-skills [--agent ${SKILL_AGENTS.join("|")}] [--project] [--dir <path>] [--force]
  harness-bridge uninstall-skills [--agent <agent>] [--project] [--dir <path>]
`);
  process.exit(2);
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function skillOptions(args: string[]): SkillInstallOptions {
  const agent = readFlag(args, "--agent");
  if (agent && !SKILL_AGENTS.includes(agent as SkillAgent)) {
    throw new Error(`Unknown --agent "${agent}". Use one of: ${SKILL_AGENTS.join(", ")}, or pass --dir.`);
  }
  return {
    agent: agent as SkillAgent | undefined,
    scope: hasFlag(args, "--project") ? "project" : "global",
    dir: readFlag(args, "--dir"),
    force: hasFlag(args, "--force")
  };
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
    if (hasFlag(args, "--local")) {
      console.error(`Kept the bridge local-only via ${excludeBridgeFromGit(process.cwd())}.`);
    }
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
      notes: readFlag(args, "--notes"),
      focus: readFlag(args, "--focus"),
      references: readFlag(args, "--references"),
      suggestedSkills: readFlag(args, "--suggested-skills")
    });
    console.log(renderBridge(doc));
    return;
  }

  if (command === "install-skills") {
    const result = installSkills(skillOptions(args));
    if (result.installed.length > 0) {
      console.log(`Installed ${result.installed.join(", ")} into ${result.targetDir}`);
    }
    if (result.skipped.length > 0) {
      console.error(
        `Skipped ${result.skipped.join(", ")}: a different skill with that name already exists in ${result.targetDir}. Re-run with --force to replace it.`
      );
      process.exitCode = 1;
    }
    console.log("Use /handoff [what the next session is for] to hand off, and /pickup to resume. Restart your agent if it is running.");
    return;
  }

  if (command === "uninstall-skills") {
    const result = uninstallSkills(skillOptions(args));
    console.log(
      result.removed.length > 0 ? `Removed ${result.removed.join(", ")} from ${result.targetDir}` : `No Harness Bridge skills found in ${result.targetDir}`
    );
    if (result.skipped.length > 0) {
      console.error(`Left ${result.skipped.join(", ")} in place: not a Harness Bridge skill. Use --force to remove anyway.`);
    }
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
