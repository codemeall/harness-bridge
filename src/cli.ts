#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline/promises";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { bridgePath, checkpointBridge, excludeBridgeFromGit, getStatus, initBridge, renderBridge, summarizeForConsume, validateBridge } from "./core/bridge.js";
import { PACKAGE_VERSION } from "./core/version.js";
import { installMaintainerRules, parseRulesTarget } from "./core/instructions.js";
import {
  BUNDLED_SKILLS,
  SKILL_AGENTS,
  agentLabel,
  detectSkillAgents,
  installSkills,
  parseSkillAgent,
  resolveSkillsTarget,
  skillStatus,
  uninstallSkills,
  withoutDuplicateTargets,
  type SkillAgent,
  type SkillInstallOptions
} from "./core/skills.js";
import { runMcpServer } from "./mcp/server.js";
import { detectDestinations, parseDestination, shellQuote, type DestinationId } from "./recovery/destinations.js";
import { buildRecoveryPackage, writeRecoveryPackage } from "./recovery/package.js";
import { readTranscriptSlice } from "./recovery/slice.js";
import { ADAPTERS, listSessions, parseProvider, resolveSession, type SessionSummary } from "./sessions/index.js";

const USAGE = `harness-bridge ${PACKAGE_VERSION}

Bridge (.harness/bridge.md):
  harness-bridge mcp                         Run the stdio MCP server
  harness-bridge status                      Validate the bridge and compare with git (JSON)
  harness-bridge validate [bridge.md]        Validate a bridge file
  harness-bridge consume                     Grounded bridge summary for a new session
  harness-bridge init --title <t> --goal <g> [--plan <md>] [--next-action <text>] [--local]
                      [--rules claude|codex|antigravity|cursor ...]   also add the maintainer rules
  harness-bridge checkpoint [--next-action <text>] [--plan <md>] [--files-touched <md>]
                            [--open-questions <md>] [--notes <text>] [--decision <text> ...]
                            [--focus <text>] [--references <md>] [--suggested-skills <md>]

Session recovery (works without the source provider):
  harness-bridge sessions [--provider claude|codex] [--limit N] [--all] [--json]
  harness-bridge recover [<session-id|transcript.jsonl>] [--provider claude|codex]
                         [--latest] [--to codex|claude|antigravity|cursor] [--write] [--launch]
                         [--budget CHARS] [--no-follow] [--json]
  harness-bridge transcript <session> [--around N | --from N --until N | --grep TEXT]
                         [--radius N] [--output] [--max-chars N]
  harness-bridge resume <session> [--provider claude|codex] [--launch]
  harness-bridge destinations

Skills (handoff, pickup, harness-bridge, recover-session):
  harness-bridge install-skills   [--agent <id> ...] [--project] [--dir <path>] [--force]
  harness-bridge uninstall-skills [--agent <id> ...] [--project] [--dir <path>] [--force]
  harness-bridge skills-status    [--agent <id> ...] [--project] [--dir <path>]   exit 1 if any is outdated
    <id>: ${SKILL_AGENTS.join(" | ")} (aliases: claude, chatgpt, agy)
    Default: every agent detected on this machine. install-skills also updates older copies it installed.

Run commands from the project workspace (or pass --cwd <path>).`;

class UsageError extends Error {}

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

function parse(args: string[], options: ParseArgsConfig["options"]): { values: Values; positionals: string[] } {
  try {
    return parseArgs({ args, options: { cwd: { type: "string" }, ...options }, allowPositionals: true, strict: true }) as { values: Values; positionals: string[] };
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function intFlag(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new UsageError(`${name} must be a non-negative integer.`);
  return n;
}

function age(iso?: string): string {
  if (!iso) return "?";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function formatSessions(sessions: SessionSummary[]): string {
  if (sessions.length === 0) return "No sessions found for this workspace. Try --all, or check the provider is Claude Code or Codex.";
  return sessions
    .map((s, i) => {
      const flag = s.endState === "usage-limit" ? "  ⚠ usage limit" : s.endState === "auth-error" ? "  ⚠ auth error" : s.endState === "interrupted" ? "  ⚠ interrupted" : "";
      const match = s.workspaceMatch === "exact" ? "" : `  [${s.workspaceMatch}]`;
      return [
        `${String(i + 1).padStart(2)}. ${s.provider.padEnd(11)} ${s.id}  ${age(s.lastActivityAt).padEnd(8)} ${(s.sizeBytes / 1048576).toFixed(1)}MB${match}${flag}`,
        `      ${s.title ?? "(untitled)"}`,
        s.lastPrompt ? `      last: ${s.lastPrompt.slice(0, 110)}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

const interactive = () => Boolean(process.stdin.isTTY && process.stderr.isTTY);

function launch(argv: string[], cwd: string): number {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 0;
}

async function cmdRecover(args: string[]) {
  const { values, positionals } = parse(args, {
    session: { type: "string" },
    provider: { type: "string" },
    latest: { type: "boolean" },
    to: { type: "string" },
    write: { type: "boolean" },
    launch: { type: "boolean" },
    budget: { type: "string" },
    "no-follow": { type: "boolean" },
    json: { type: "boolean" }
  });
  const cwd = (values.cwd as string | undefined) ?? process.cwd();
  const provider = parseProvider(values.provider as string | undefined);
  let session = (values.session as string | undefined) ?? positionals[0];
  let to = values.to ? parseDestination(values.to as string) : undefined;

  if (!session) {
    const candidates = listSessions(cwd, { provider, limit: 8 });
    const sameWorkspace = candidates.filter((s) => s.workspaceMatch === "exact" || s.workspaceMatch === "subdir");
    if (values.latest) {
      if (sameWorkspace.length === 0) throw new UsageError("--latest found no session recorded in this workspace. Run `harness-bridge sessions --all`.");
      session = sameWorkspace[0].id;
      console.error(`Using the most recent session in this workspace: ${sameWorkspace[0].provider} ${session} — ${sameWorkspace[0].title ?? ""}`);
    } else if (interactive() && candidates.length > 0) {
      console.error(`Recent sessions for this workspace:\n${formatSessions(candidates)}\n`);
      const choice = Number(await ask(`Recover which session? [1-${candidates.length}] `));
      if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) throw new UsageError("No session selected.");
      session = candidates[choice - 1].id;
    } else {
      console.error(`${formatSessions(candidates)}\n`);
      throw new UsageError("Pick a session: harness-bridge recover <session-id> (or --latest for the newest in this workspace). Recovery never guesses.");
    }
  }

  if (!to && values.launch) throw new UsageError("--launch needs --to <destination>.");
  if (!to && interactive() && !values.json) {
    const installed = detectDestinations().filter((d) => d.installed);
    if (installed.length > 0) {
      const names = installed.map((d, i) => `${i + 1}. ${d.name}`).join("  ");
      const answer = await ask(`Continue in which provider? ${names}  (Enter = just show the package) `);
      const index = Number(answer);
      if (answer && Number.isInteger(index) && index >= 1 && index <= installed.length) to = installed[index - 1].id as DestinationId;
    }
  }

  const pkg = buildRecoveryPackage({
    cwd,
    session,
    provider,
    to,
    follow: !values["no-follow"],
    budgetChars: intFlag(values.budget, "--budget")
  });

  let written: string | undefined;
  if (values.write || to || values.launch) written = writeRecoveryPackage(cwd, pkg);

  if (values.json) {
    console.log(JSON.stringify({ written, relativePath: pkg.relativePath, session: pkg.session, endState: pkg.collected.end, bridge: pkg.bridge, nativeResume: pkg.nativeResume, continuation: pkg.continuation, limitations: pkg.limitations, markdown: pkg.markdown }, null, 2));
    return;
  }
  if (!written) console.log(pkg.markdown);
  console.error("");
  console.error(written ? `Recovery package written to ${written} (git-ignored).` : "Preview only. Add --write (or --to <provider>) to save it under .harness/recovery/.");
  console.error(`Native resume, same provider: ${pkg.nativeResume.command} (${pkg.nativeResume.note})`);
  if (pkg.continuation) {
    const ct = pkg.continuation;
    console.error(`Continue in ${ct.name}: ${ct.command}`);
    if (!ct.installed) console.error(`  ${ct.name} was not found on PATH; install it or paste this prompt into it manually:\n  ${ct.prompt}`);
    if (values.launch) {
      if (!ct.installed) throw new Error(`Cannot launch ${ct.name}: not installed.`);
      if (!interactive()) throw new Error("--launch needs an interactive terminal; run the command above yourself.");
      process.exitCode = launch(ct.argv, pkg.session.workspaceMatch === "none" ? cwd : getStatus(cwd).git.root);
    }
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  // `<command> --help` is the first thing people and agents try.
  if (!command || command === "--help" || command === "-h" || command === "help" || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log(PACKAGE_VERSION);
    return;
  }

  switch (command) {
    case "mcp": {
      const { values } = parse(args, {});
      await runMcpServer((values.cwd as string | undefined) ?? process.cwd());
      return;
    }
    case "status": {
      const { values } = parse(args, {});
      console.log(JSON.stringify(getStatus((values.cwd as string | undefined) ?? process.cwd()), null, 2));
      return;
    }
    case "validate": {
      const { values, positionals } = parse(args, {});
      const file = positionals[0] ?? bridgePath((values.cwd as string | undefined) ?? process.cwd());
      if (!fs.existsSync(file)) throw new Error(`No bridge file at ${file}.`);
      const result = validateBridge(fs.readFileSync(file, "utf8"));
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
      return;
    }
    case "consume": {
      const { values } = parse(args, {});
      console.log(summarizeForConsume((values.cwd as string | undefined) ?? process.cwd()));
      return;
    }
    case "init": {
      const { values } = parse(args, {
        title: { type: "string" },
        goal: { type: "string" },
        plan: { type: "string" },
        "next-action": { type: "string" },
        rules: { type: "string", multiple: true },
        local: { type: "boolean" }
      });
      if (!values.title || !values.goal) throw new UsageError("init requires --title and --goal.");
      const rules = ((values.rules as string[] | undefined) ?? []).map((value) => {
        try {
          return parseRulesTarget(value);
        } catch (error) {
          throw new UsageError((error as Error).message);
        }
      });
      const doc = initBridge({
        cwd: (values.cwd as string | undefined) ?? process.cwd(),
        generatedBy: "cli:harness-bridge",
        title: values.title as string,
        goal: values.goal as string,
        plan: values.plan as string | undefined,
        nextAction: values["next-action"] as string | undefined
      });
      for (const target of rules) console.error(installMaintainerRules((values.cwd as string | undefined) ?? process.cwd(), target));
      if (values.local) console.error(`Kept the bridge local-only via ${excludeBridgeFromGit((values.cwd as string | undefined) ?? process.cwd())}.`);
      console.log(renderBridge(doc));
      return;
    }
    case "checkpoint": {
      const { values } = parse(args, {
        title: { type: "string" },
        goal: { type: "string" },
        plan: { type: "string" },
        "next-action": { type: "string" },
        "open-questions": { type: "string" },
        "files-touched": { type: "string" },
        notes: { type: "string" },
        decision: { type: "string", multiple: true },
        focus: { type: "string" },
        references: { type: "string" },
        "suggested-skills": { type: "string" }
      });
      const doc = checkpointBridge({
        cwd: (values.cwd as string | undefined) ?? process.cwd(),
        generatedBy: "cli:harness-bridge",
        title: values.title as string | undefined,
        goal: values.goal as string | undefined,
        plan: values.plan as string | undefined,
        nextAction: values["next-action"] as string | undefined,
        openQuestions: values["open-questions"] as string | undefined,
        filesTouched: values["files-touched"] as string | undefined,
        notes: values.notes as string | undefined,
        decisionsToAppend: values.decision as string[] | undefined,
        focus: values.focus as string | undefined,
        references: values.references as string | undefined,
        suggestedSkills: values["suggested-skills"] as string | undefined
      });
      console.log(renderBridge(doc));
      return;
    }
    case "sessions": {
      const { values } = parse(args, { provider: { type: "string" }, limit: { type: "string" }, all: { type: "boolean" }, json: { type: "boolean" } });
      const sessions = listSessions((values.cwd as string | undefined) ?? process.cwd(), {
        provider: parseProvider(values.provider as string | undefined),
        limit: intFlag(values.limit, "--limit") ?? 10,
        all: Boolean(values.all)
      });
      console.log(values.json ? JSON.stringify(sessions, null, 2) : formatSessions(sessions));
      return;
    }
    case "recover":
      await cmdRecover(args);
      return;
    case "transcript": {
      const { values, positionals } = parse(args, {
        provider: { type: "string" },
        from: { type: "string" },
        until: { type: "string" },
        around: { type: "string" },
        radius: { type: "string" },
        grep: { type: "string" },
        output: { type: "boolean" },
        "max-chars": { type: "string" }
      });
      if (!positionals[0]) throw new UsageError("transcript needs a session id or transcript path.");
      console.log(
        readTranscriptSlice({
          session: positionals[0],
          provider: parseProvider(values.provider as string | undefined),
          from: intFlag(values.from, "--from"),
          to: intFlag(values.until, "--until"),
          around: intFlag(values.around, "--around"),
          radius: intFlag(values.radius, "--radius"),
          grep: values.grep as string | undefined,
          includeToolOutput: Boolean(values.output),
          maxChars: intFlag(values["max-chars"], "--max-chars")
        })
      );
      return;
    }
    case "resume": {
      const { values, positionals } = parse(args, { provider: { type: "string" }, launch: { type: "boolean" } });
      if (!positionals[0]) throw new UsageError("resume needs a session id.");
      const resolved = resolveSession(positionals[0], parseProvider(values.provider as string | undefined));
      const summary = resolved.adapter.summarize(resolved.path, undefined);
      const argv = resolved.adapter.nativeResumeCommand(summary.id);
      const runIn = summary.cwd && fs.existsSync(summary.cwd) ? summary.cwd : process.cwd();
      console.error(`Native ${resolved.adapter.displayName} resume keeps that provider's own history. If the session hit a usage limit, this only works after the limit resets; use \`harness-bridge recover\` to continue elsewhere now.`);
      console.log(`cd ${shellQuote([runIn])} && ${shellQuote(argv)}`);
      if (values.launch) {
        if (!interactive()) throw new Error("--launch needs an interactive terminal.");
        process.exitCode = launch(argv, runIn);
      }
      return;
    }
    case "destinations": {
      for (const d of detectDestinations()) {
        console.log(`${d.installed ? "✓" : "✗"} ${d.name.padEnd(14)} ${d.installed ? d.binaryPath : "not on PATH"}  — ${d.launchVerified}`);
      }
      for (const adapter of Object.values(ADAPTERS)) console.log(`  transcripts: ${adapter.displayName} → ${adapter.roots().join(", ")}`);
      return;
    }
    case "install-skills":
    case "uninstall-skills":
    case "skills-status": {
      const { values } = parse(args, { agent: { type: "string", multiple: true }, project: { type: "boolean" }, dir: { type: "string" }, force: { type: "boolean" } });
      const cwd = (values.cwd as string | undefined) ?? process.cwd();
      let agents: (SkillAgent | undefined)[];
      try {
        agents = ((values.agent as string[] | undefined) ?? []).map(parseSkillAgent);
      } catch (error) {
        throw new UsageError((error as Error).message);
      }
      if (values.dir) agents = [undefined];
      else if (agents.length === 0) {
        const detected = detectSkillAgents();
        const { agents: unique, covered } = values.project ? { agents: detected, covered: [] } : withoutDuplicateTargets(detected);
        agents = unique.length > 0 ? unique : ["claude-code"];
        for (const agent of covered) console.log(`${agentLabel(agent)}: already loads ~/.claude/skills and ~/.agents/skills (pass --agent ${agent} to install separately)`);
      }
      const targets = new Map<string, { options: SkillInstallOptions; labels: string[] }>();
      for (const agent of agents) {
        const options: SkillInstallOptions = { agent, scope: values.project ? "project" : "global", dir: values.dir as string | undefined, cwd, force: Boolean(values.force) };
        const dir = resolveSkillsTarget(options);
        const entry = targets.get(dir) ?? { options, labels: [] };
        entry.labels.push(agent ? agentLabel(agent) : "custom dir");
        targets.set(dir, entry);
      }
      let attention = false;
      for (const [dir, { options, labels }] of targets) {
        console.log(`${labels.join(", ")} → ${dir}`);
        if (command === "skills-status") {
          for (const skill of BUNDLED_SKILLS) {
            const st = skillStatus(dir, skill);
            if (st.state === "outdated" || st.state === "missing") attention = true;
            console.log(`  ${skill.padEnd(16)} ${st.state}${st.installedVersion && st.state !== "current" ? ` (installed ${st.installedVersion}, bundled ${st.bundledVersion})` : ""}`);
          }
          continue;
        }
        const result = command === "install-skills" ? installSkills(options) : uninstallSkills(options);
        if (result.installed.length) console.log(`  installed: ${result.installed.join(", ")}`);
        if (result.updated.length) console.log(`  updated:   ${result.updated.join(", ")}`);
        if (result.removed.length) console.log(`  removed:   ${result.removed.join(", ")}`);
        if (command === "uninstall-skills" && !result.removed.length && !result.skipped.length) console.log("  nothing to remove");
        for (const skill of result.skipped) {
          attention = true;
          console.error(`  skipped:   ${skill} — ${result.reasons[skill]}`);
        }
      }
      if (command === "install-skills") console.log("Restart running agents to load the skills. Use /handoff to hand off, /pickup to resume, /recover-session after a crash or usage limit.");
      if (attention) process.exitCode = 1;
      return;
    }
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\nRun \`harness-bridge --help\` for usage.`);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

