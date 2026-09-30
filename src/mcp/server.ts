import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import {
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
import { getRepoRoot } from "../core/git.js";
import { PACKAGE_VERSION } from "../core/version.js";
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
  return cwd ? path.resolve(cwd) : defaultCwd;
}

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

function extractMaintainerSnippet(): string {
  const maintainer = readPrompt("maintainer");
  const match = maintainer.match(/--- begin snippet ---\n([\s\S]*?)\n--- end snippet ---/);
  if (!match) {
    throw new Error("Could not find maintainer snippet markers in prompts/maintainer.md.");
  }
  return match[1].trimEnd();
}

function installProviderInstructions(cwd: string, provider: "claude-code" | "codex" | "gemini-cli" | "cursor"): string {
  const root = getRepoRoot(cwd);
  const snippet = extractMaintainerSnippet();

  if (provider === "cursor") {
    const cursorRule = path.join(root, ".cursor/rules/harness-bridge.md");
    fs.mkdirSync(path.dirname(cursorRule), { recursive: true });
    if (fs.existsSync(cursorRule) && fs.readFileSync(cursorRule, "utf8").includes("## Harness Bridge — keep .harness/bridge.md current")) {
      return `${cursorRule} already contains Harness Bridge instructions.`;
    }
    fs.writeFileSync(cursorRule, `${snippet}\n`, "utf8");
    return `Created ${cursorRule}.`;
  }

  const instructionFile =
    provider === "claude-code" ? "CLAUDE.md" : provider === "codex" ? "AGENTS.md" : "GEMINI.md";
  const target = path.join(root, instructionFile);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (existing.includes("## Harness Bridge — keep .harness/bridge.md current")) {
    return `${target} already contains Harness Bridge instructions.`;
  }

  const separator = existing.trim().length > 0 ? "\n\n" : "";
  fs.writeFileSync(target, `${existing.trimEnd()}${separator}${snippet}\n`, "utf8");
  return `Updated ${target}.`;
}

const cwdArg = z.string().optional().describe("Absolute path to the target workspace repo. Defaults to the MCP server cwd.");

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
  cadence: z.enum(["checkpoint", "lazy", "aggressive"]).optional()
};

export function createHarnessBridgeServer(cwd = process.cwd()): McpServer {
  const server = new McpServer(
    {
      name: "harness-bridge",
      version: PACKAGE_VERSION
    },
    {
      instructions:
        "Use Harness Bridge tools to maintain .harness/bridge.md for serial AI coding-agent handoffs. The bridge file remains the source of truth. Reference existing artifacts (specs, ADRs, issues, PRs, commits) instead of copying them into the bridge, and never write secrets or personal data. After bridge_consume, restate the returned state, load any suggested skills, and wait for user confirmation before executing."
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
      cadence: z.enum(["checkpoint", "lazy", "aggressive"]).default("checkpoint"),
      cwd: cwdArg,
      localOnly: z
        .boolean()
        .default(false)
        .describe("Keep the bridge out of git by adding .harness/ to this clone's .git/info/exclude (no shared .gitignore change)."),
      installInstructionsFor: z
        .enum(["claude-code", "codex", "gemini-cli", "cursor"])
        .optional()
        .describe("Optional provider instruction file to update with the canonical maintainer snippet from prompts/maintainer.md.")
    },
    async ({ title, goal, plan, nextAction, generatedBy, cadence, cwd: requestedCwd, localOnly, installInstructionsFor }) => {
      const resolvedCwd = targetCwd(cwd, requestedCwd);
      const doc = initBridge({ cwd: resolvedCwd, title, goal, plan, nextAction, generatedBy, cadence });
      const instructionResult = installInstructionsFor ? installProviderInstructions(resolvedCwd, installInstructionsFor) : "";
      const localOnlyResult = localOnly ? `Kept the bridge local-only via ${excludeBridgeFromGit(resolvedCwd)}.` : "";
      return textResponse(
        [
          instructionResult,
          localOnlyResult,
          `Initialized bridge at ${bridgePath(resolvedCwd)} using the prompts/init.md schema and prompts/maintainer.md template.`,
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
    "Assist recovery from transcript-derived content. This tool validates and writes agent-supplied recovered bridge content, or reports a redacted transcript excerpt in verify mode.",
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

  return server;
}

export async function runMcpServer(cwd = process.cwd()): Promise<void> {
  const server = createHarnessBridgeServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
