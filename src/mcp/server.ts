import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  bridgeExists,
  bridgePath,
  checkpointBridge,
  excludeBridgeFromGit,
  getStatus,
  initBridge,
  parseBridge,
  redactSecrets,
  renderBridge,
  summarizeForConsume,
  validateBridge,
  writeBridge
} from "../core/bridge.js";
import { RULES_TARGETS, installMaintainerRules } from "../core/instructions.js";
import { resolveWorkspace } from "../core/git.js";
import { PACKAGE_VERSION } from "../core/version.js";
import { detectDestinations, parseDestination } from "../recovery/destinations.js";
import { buildRecoveryPackage, listRecoveryPackages, writeRecoveryPackage } from "../recovery/package.js";
import { readTranscriptSlice } from "../recovery/slice.js";
import { listSessions, parseProvider } from "../sessions/index.js";
import fs from "node:fs";

const PROMPT_FILES = {
  init: "init.md",
  maintainer: "maintainer.md",
  producer: "producer.md",
  consumer: "consumer.md",
  recover: "recover.md",
  uninstall: "uninstall.md"
} as const;

type PromptName = keyof typeof PROMPT_FILES;

const PROMPT_DIR = new URL("../../prompts/", import.meta.url);

function textResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text
      }
    ]
  };
}

function jsonResponse(value: unknown) {
  return textResponse(JSON.stringify(value, null, 2));
}

function targetCwd(defaultCwd: string, cwd?: string): string {
  return resolveWorkspace(cwd ?? defaultCwd);
}

const cwdArg = z.string().optional().describe("Absolute workspace path. Defaults to the MCP server cwd.");
const cadenceArg = z.enum(["checkpoint", "lazy", "aggressive"]);


function hasBridgePatch(args: {
  title?: string;
  goal?: string;
  plan?: string;
  nextAction?: string;
  decisionsToAppend?: string[];
  openQuestions?: string;
  filesTouched?: string;
  notes?: string;
  focus?: string;
  references?: string;
  suggestedSkills?: string;
}): boolean {
  return Boolean(
    args.title?.trim() ||
      args.goal?.trim() ||
      args.plan?.trim() ||
      args.nextAction?.trim() ||
      (args.decisionsToAppend?.some((item) => item.trim().length > 0) ?? false) ||
      args.openQuestions?.trim() ||
      args.filesTouched?.trim() ||
      args.notes?.trim() ||
      args.focus?.trim() ||
      args.references?.trim() ||
      args.suggestedSkills?.trim()
  );
}

function readPrompt(name: PromptName): string {
  return fs.readFileSync(new URL(PROMPT_FILES[name], PROMPT_DIR), "utf8");
}

function promptMessage(name: PromptName) {
  return {
    description: `Harness Bridge ${name} prompt from prompts/${PROMPT_FILES[name]}.`,
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: readPrompt(name)
        }
      }
    ]
  };
}


const handoffFields = {
  title: z.string().optional(),
  goal: z.string().optional(),
  plan: z.string().optional().describe("Full markdown checklist using [x] done, [~] in progress, [ ] pending."),
  nextAction: z.string().optional().describe("Imperative, specific, executable without the rest of the bridge."),
  decisionsToAppend: z.array(z.string()).optional().describe("New decisions with rationale. Appended; never rewrites old ones."),
  openQuestions: z.string().optional(),
  filesTouched: z.string().optional(),
  notes: z.string().optional(),
  focus: z
    .string()
    .optional()
    .describe("What the next session will be used for. Replaces the 'Next session focus' section; pass an empty string to clear it."),
  references: z
    .string()
    .optional()
    .describe(
      "Markdown list of paths/URLs to specs, plans, ADRs, issues, PRs, or commits that already capture context. Reference them here instead of copying their content into the bridge. Empty string clears it."
    ),
  suggestedSkills: z
    .string()
    .optional()
    .describe("Markdown list of skills (or MCP tools) the next agent should load, each with a short reason. Empty string clears it."),
  generatedBy: z.string().default("mcp:harness-bridge"),
  cwd: cwdArg,
  cadence: cadenceArg.optional()
};

export function createHarnessBridgeServer(cwd = process.cwd()): McpServer {
  const server = new McpServer(
    {
      name: "harness-bridge",
      version: PACKAGE_VERSION
    },
    {
      instructions:
        "Harness Bridge keeps .harness/bridge.md as the source of truth for serial coding-agent handoffs. Reference existing artifacts (specs, ADRs, issues, PRs) instead of copying them. After bridge_consume or session_recover, restate the state and wait for user confirmation before editing. To continue a session another provider could not finish (e.g. usage limit), use session_list → session_recover; they read local transcripts and never contact the source provider."
    }
  );

  for (const promptName of Object.keys(PROMPT_FILES) as PromptName[]) {
    const uri = `harness-bridge://prompts/${PROMPT_FILES[promptName]}`;
    server.registerResource(
      `prompt-${promptName}`,
      uri,
      {
        title: `Harness Bridge ${promptName} prompt`,
        description: `Canonical prompt file prompts/${PROMPT_FILES[promptName]}.`,
        mimeType: "text/markdown"
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: readPrompt(promptName)
          }
        ]
      })
    );

    server.registerPrompt(
      `bridge_${promptName.replace("-", "_")}_prompt`,
      {
        title: `Harness Bridge ${promptName}`,
        description: `Return the canonical prompts/${PROMPT_FILES[promptName]} text.`
      },
      async () => promptMessage(promptName)
    );
  }

  server.tool(
    "bridge_status",
    "Read .harness/bridge.md, validate it, and compare frontmatter against current git state.",
    {
      cwd: cwdArg
    },
    async ({ cwd: requestedCwd }) => jsonResponse(getStatus(targetCwd(cwd, requestedCwd)))
  );

  server.tool(
    "bridge_validate",
    "Validate a bridge markdown string, or validate the current repo bridge when markdown is omitted.",
    {
      markdown: z.string().optional(),
      cwd: cwdArg
    },
    async ({ markdown, cwd: requestedCwd }) => {
      const resolvedCwd = targetCwd(cwd, requestedCwd);
      const file = bridgePath(resolvedCwd);
      const target = markdown ?? (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
      if (!target) {
        return jsonResponse({ valid: false, errors: ["No bridge markdown provided and no repo bridge exists."], warnings: [] });
      }
      return jsonResponse(validateBridge(target));
    }
  );

  server.tool(
    "bridge_init",
    "Create .harness/bridge.md for the current repo if missing.",
    {
      title: z.string().describe("One-line bridge title."),
      goal: z.string().describe("2-4 sentences explaining the destination and why."),
      plan: z.string().optional().describe("Markdown checklist for the initial plan."),
      nextAction: z.string().optional().describe("Imperative next action."),
      generatedBy: z.string().default("mcp:harness-bridge"),
      cadence: cadenceArg.default("checkpoint"),
      cwd: cwdArg,
      localOnly: z
        .boolean()
        .default(false)
        .describe("Keep the bridge out of git by adding .harness/ to this clone's .git/info/exclude (no shared .gitignore change)."),
      installInstructionsFor: z
        .union([z.enum(RULES_TARGETS), z.array(z.enum(RULES_TARGETS))])
        .optional()
        .describe("Optional provider instruction file to update with the canonical maintainer snippet from prompts/maintainer.md.")
    },
    async ({ title, goal, plan, nextAction, generatedBy, cadence, cwd: requestedCwd, localOnly, installInstructionsFor }) => {
      const resolvedCwd = targetCwd(cwd, requestedCwd);
      const existed = bridgeExists(resolvedCwd);
      const doc = initBridge({ cwd: resolvedCwd, title, goal, plan, nextAction, generatedBy, cadence });
      const targets = installInstructionsFor === undefined ? [] : Array.isArray(installInstructionsFor) ? installInstructionsFor : [installInstructionsFor];
      const instructionResult = targets.map((target) => installMaintainerRules(resolvedCwd, target)).join("\n");
      const localOnlyResult = localOnly ? `Kept the bridge local-only via ${excludeBridgeFromGit(resolvedCwd)}.` : "";
      return textResponse(
        [
          instructionResult,
          localOnlyResult,
          existed
            ? `Bridge already exists at ${bridgePath(resolvedCwd)}; left unchanged. Use bridge_checkpoint to update it.`
            : `Initialized bridge at ${bridgePath(resolvedCwd)}.`,
          renderBridge(doc)
        ]
          .filter(Boolean)
          .join("\n\n")
      );
    }
  );

  server.tool(
    "bridge_checkpoint",
    "Patch checkpoint fields in .harness/bridge.md after a completed step, decision, or edit batch.",
    handoffFields,
    async (args) => {
      const resolvedCwd = targetCwd(cwd, args.cwd);
      const doc = checkpointBridge({ ...args, cwd: resolvedCwd });
      return textResponse([`Updated bridge at ${bridgePath(resolvedCwd)}.`, renderBridge(doc)].join("\n\n"));
    }
  );

  server.tool(
    "bridge_produce",
    "Finalize the bridge before a deliberate handoff. Review the whole session and pass what changed: sharpened nextAction, plan, appended decisions, open questions, files touched. If the user said what the next session is for, pass it as focus and tailor nextAction to it. List skills the next agent should load in suggestedSkills, and point to existing specs/ADRs/issues/PRs/commits in references instead of copying them. Set confirmNoChanges only when the bridge is already complete.",
    {
      ...handoffFields,
      confirmNoChanges: z
        .boolean()
        .default(false)
        .describe("Set true only after reviewing this session and confirming the existing bridge needs no content changes.")
    },
    async (args) => {
      if (!args.confirmNoChanges && !hasBridgePatch(args)) {
        throw new Error(
          "bridge_produce requires handoff content. Provide updated plan/nextAction/filesTouched/etc., or set confirmNoChanges=true after verifying the existing bridge is already current."
        );
      }
      const resolvedCwd = targetCwd(cwd, args.cwd);
      const doc = checkpointBridge({ ...args, cwd: resolvedCwd });
      return textResponse(
        [
          `Produced handoff bridge at ${bridgePath(resolvedCwd)}.`,
          "To resume in a fresh session (same or different agent), open this repo and run /pickup, or say: Consume the Harness Bridge and restate where we are.",
          renderBridge(doc)
        ].join("\n\n")
      );
    }
  );

  server.tool(
    "bridge_consume",
    "Return grounded bridge state for a fresh session. The caller must restate it and wait for user confirmation before acting.",
    {
      cwd: cwdArg
    },
    async ({ cwd: requestedCwd }) => textResponse(summarizeForConsume(targetCwd(cwd, requestedCwd)))
  );

  server.tool(
    "bridge_recover",
    "Validate and (with write:true, after user confirmation) write a bridge rebuilt from recovered evidence. Get the evidence from session_recover first; do not paste raw transcripts here.",
    {
      mode: z.enum(["full", "since", "verify"]),
      recoveredBridgeMarkdown: z
        .string()
        .optional()
        .describe("Complete recovered bridge markdown for full/since modes, synthesized by the agent from transcript evidence."),
      transcriptText: z.string().optional().describe("Optional transcript text to redact and inspect in verify mode."),
      cwd: cwdArg,
      write: z.boolean().default(false).describe("Set true only after user confirmation.")
    },
    async ({ mode, recoveredBridgeMarkdown, transcriptText, cwd: requestedCwd, write }) => {
      if (mode === "verify") {
        return textResponse(redactSecrets(transcriptText ?? "No transcript text provided. Report discrepancies without modifying files."));
      }

      if (!recoveredBridgeMarkdown) {
        return jsonResponse({
          written: false,
          error: "full/since recovery requires recoveredBridgeMarkdown generated from transcript evidence."
        });
      }

      const validation = validateBridge(recoveredBridgeMarkdown);
      if (!validation.valid) {
        return jsonResponse({ written: false, validation });
      }

      if (!write) {
        return jsonResponse({ written: false, validation, preview: redactSecrets(recoveredBridgeMarkdown) });
      }

      const resolvedCwd = targetCwd(cwd, requestedCwd);
      writeBridge(resolvedCwd, parseBridge(recoveredBridgeMarkdown));
      return jsonResponse({ written: true, path: bridgePath(resolvedCwd), validation });
    }
  );

  const providerArg = z.enum(["claude-code", "codex", "claude"]).optional().describe("Source provider. Omit to search Claude Code and Codex.");

  server.tool(
    "session_list",
    "List recent Claude Code / Codex sessions recorded for this workspace (newest first) with title, last prompt and how each ended (e.g. usage-limit). Use it to let the user pick the session to recover.",
    {
      cwd: cwdArg,
      provider: providerArg,
      limit: z.number().int().min(1).max(50).default(10),
      all: z.boolean().default(false).describe("Include sessions from other workspaces.")
    },
    async ({ cwd: requestedCwd, provider, limit, all }) => {
      const resolvedCwd = targetCwd(cwd, requestedCwd);
      const sessions = listSessions(resolvedCwd, { provider: parseProvider(provider), limit, all });
      const recoveries = listRecoveryPackages(resolvedCwd).slice(0, 5);
      return jsonResponse({
        sessions: sessions.map(({ path: transcript, ...rest }) => ({ ...rest, transcript })),
        previousRecoveries: recoveries,
        note: "Ask the user which session to recover unless they named one. Never pick a session from another workspace silently."
      });
    }
  );

  server.tool(
    "session_recover",
    "Build a compact recovery package (goal, task state, files vs repo, commands, bridge staleness, limitations) from a session transcript without contacting the source provider. Requires an explicit session id or transcript path.",
    {
      session: z.string().describe("Session id from session_list, or a transcript .jsonl path under the provider's transcript directory."),
      provider: providerArg,
      cwd: cwdArg,
      to: z.enum(["codex", "claude-code", "antigravity", "cursor"]).optional().describe("Destination provider, to include a ready-to-run continuation command."),
      budgetChars: z.number().int().min(2000).max(40000).default(12000),
      write: z.boolean().default(false).describe("Save the package to .harness/recovery/ (git-ignored). Set only when the user asked to save or hand off.")
    },
    async ({ session, provider, cwd: requestedCwd, to, budgetChars, write }) => {
      const resolvedCwd = targetCwd(cwd, requestedCwd);
      const pkg = buildRecoveryPackage({ cwd: resolvedCwd, session, provider: parseProvider(provider), to: to ? parseDestination(to) : undefined, budgetChars });
      const written = write ? writeRecoveryPackage(resolvedCwd, pkg) : undefined;
      const footer = [
        written ? `Saved to ${written}.` : `Not saved (pass write:true to save as ${pkg.relativePath}).`,
        pkg.continuation ? `Continue in ${pkg.continuation.name}: ${pkg.continuation.command}` : "",
        "Next: verify task claims against the repo, restate goal / done / in progress / next action, and wait for user confirmation. Then write the bridge with bridge_recover (write:true) or bridge_checkpoint."
      ].filter(Boolean);
      return textResponse(`${pkg.markdown}\n\n---\n${footer.join("\n")}`);
    }
  );

  server.tool(
    "session_read",
    "Read a bounded, redacted slice of a session transcript (by line range, around a line, or text search). Use only when the recovery package is missing a detail.",
    {
      session: z.string(),
      provider: providerArg,
      from: z.number().int().min(1).optional(),
      to: z.number().int().min(1).optional(),
      around: z.number().int().min(1).optional(),
      radius: z.number().int().min(1).max(200).default(15),
      grep: z.string().min(2).optional(),
      includeToolOutput: z.boolean().default(false),
      maxChars: z.number().int().min(500).max(40000).default(8000)
    },
    async (args) => textResponse(readTranscriptSlice({ ...args, provider: parseProvider(args.provider) }))
  );

  server.tool(
    "session_destinations",
    "List coding-agent CLIs installed on this machine that a recovered session can continue in.",
    {},
    async () =>
      jsonResponse(detectDestinations().map(({ id, name, installed, binaryPath, launchVerified }) => ({ id, name, installed, binaryPath, launchVerified })))
  );

  return server;
}

export async function runMcpServer(cwd = process.cwd()): Promise<void> {
  const server = createHarnessBridgeServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
