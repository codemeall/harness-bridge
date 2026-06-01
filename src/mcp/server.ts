import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import {
  bridgePath,
  checkpointBridge,
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
import { initVault, vaultStatus } from "../core/vault.js";
import { PACKAGE_VERSION } from "../core/version.js";
import fs from "node:fs";

const PROMPT_FILES = {
  init: "init.md",
  maintainer: "maintainer.md",
  producer: "producer.md",
  consumer: "consumer.md",
  recover: "recover.md",
  uninstall: "uninstall.md",
  "vault-init": "vault-init.md"
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
}): boolean {
  return Boolean(
    args.title?.trim() ||
      args.goal?.trim() ||
      args.plan?.trim() ||
      args.nextAction?.trim() ||
      (args.decisionsToAppend?.some((item) => item.trim().length > 0) ?? false) ||
      args.openQuestions?.trim() ||
      args.filesTouched?.trim() ||
      args.notes?.trim()
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

export function createHarnessBridgeServer(cwd = process.cwd()): McpServer {
  const server = new McpServer(
    {
      name: "harness-bridge",
      version: PACKAGE_VERSION
    },
    {
      instructions:
        "Use Harness Bridge tools to maintain .harness/bridge.md for serial AI coding-agent handoffs. The bridge file remains the source of truth. After bridge_consume, restate the returned state and wait for user confirmation before executing."
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
      cwd: z.string().optional().describe("Absolute path to the target workspace repo. Defaults to the MCP server cwd.")
    },
    async ({ cwd: requestedCwd }) => jsonResponse(getStatus(targetCwd(cwd, requestedCwd)))
  );

  server.tool(
    "bridge_validate",
    "Validate a bridge markdown string, or validate the current repo bridge when markdown is omitted.",
    {
      markdown: z.string().optional(),
      cwd: z.string().optional().describe("Absolute path to the target workspace repo. Defaults to the MCP server cwd.")
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
      cwd: z.string().optional().describe("Absolute path to the target workspace repo. Defaults to the MCP server cwd."),
      installInstructionsFor: z
        .enum(["claude-code", "codex", "gemini-cli", "cursor"])
        .optional()
        .describe("Optional provider instruction file to update with the canonical maintainer snippet from prompts/maintainer.md.")
    },
    async ({ title, goal, plan, nextAction, generatedBy, cadence, cwd: requestedCwd, installInstructionsFor }) => {
      const resolvedCwd = targetCwd(cwd, requestedCwd);
      const doc = initBridge({ cwd: resolvedCwd, title, goal, plan, nextAction, generatedBy, cadence });
      const instructionResult = installInstructionsFor ? installProviderInstructions(resolvedCwd, installInstructionsFor) : "";
      return textResponse(
        [
          instructionResult,
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
    {
      title: z.string().optional(),
      goal: z.string().optional(),
      plan: z.string().optional(),
      nextAction: z.string().optional(),
      decisionsToAppend: z.array(z.string()).optional(),
      openQuestions: z.string().optional(),
      filesTouched: z.string().optional(),
      notes: z.string().optional(),
      generatedBy: z.string().default("mcp:harness-bridge"),
      cwd: z.string().optional().describe("Absolute path to the target workspace repo. Defaults to the MCP server cwd."),
      cadence: z.enum(["checkpoint", "lazy", "aggressive"]).optional()
    },
    async (args) => {
      const resolvedCwd = targetCwd(cwd, args.cwd);
      const doc = checkpointBridge({ ...args, cwd: resolvedCwd });
      return textResponse([`Updated bridge at ${bridgePath(resolvedCwd)}.`, renderBridge(doc)].join("\n\n"));
    }
  );

  server.tool(
    "bridge_produce",
    "Finalize the bridge before a deliberate handoff. Provide the current session summary fields, or set confirmNoChanges when the bridge is already current.",
    {
      title: z.string().optional(),
      goal: z.string().optional(),
      plan: z.string().optional(),
      nextAction: z.string().optional(),
      decisionsToAppend: z.array(z.string()).optional(),
      openQuestions: z.string().optional(),
      filesTouched: z.string().optional(),
      notes: z.string().optional(),
      generatedBy: z.string().default("mcp:harness-bridge"),
      cwd: z.string().optional().describe("Absolute path to the target workspace repo. Defaults to the MCP server cwd."),
      confirmNoChanges: z
        .boolean()
        .default(false)
        .describe("Set true only after reviewing this session and confirming the existing bridge needs no content changes."),
      cadence: z.enum(["checkpoint", "lazy", "aggressive"]).optional()
    },
    async (args) => {
      if (!args.confirmNoChanges && !hasBridgePatch(args)) {
        throw new Error(
          "bridge_produce requires handoff content. Provide updated plan/nextAction/filesTouched/etc., or set confirmNoChanges=true after verifying the existing bridge is already current."
        );
      }
      const resolvedCwd = targetCwd(cwd, args.cwd);
      const doc = checkpointBridge({ ...args, cwd: resolvedCwd });
      return textResponse([`Produced handoff bridge at ${bridgePath(resolvedCwd)}.`, renderBridge(doc)].join("\n\n"));
    }
  );

  server.tool(
    "bridge_consume",
    "Return grounded bridge state for a fresh session. The caller must restate it and wait for user confirmation before acting.",
    {
      cwd: z.string().optional().describe("Absolute path to the target workspace repo. Defaults to the MCP server cwd.")
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
      cwd: z.string().optional().describe("Absolute path to the target workspace repo. Defaults to the MCP server cwd."),
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

  server.tool(
    "vault_init",
    "Scaffold an LLM Wiki / second-brain vault in the current directory: creates raw/, wiki/{entities,concepts,sources,syntheses}/, CLAUDE.md, AGENTS.md, wiki/index.md, wiki/log.md. Works in an empty dir (standalone vault) or alongside an existing project (appends a marker-fenced vault schema to the host CLAUDE.md/AGENTS.md). Idempotent on the schema-append path.",
    {
      vaultName: z.string().describe("Display name for the vault (used in CLAUDE.md heading and wiki/index.md)."),
      domain: z
        .string()
        .optional()
        .describe("Optional domain hint (e.g. 'software project', 'research', 'personal'). Recorded as a comment in CLAUDE.md."),
      pairedProjects: z
        .array(
          z.object({
            name: z.string(),
            path: z.string(),
            purpose: z.string(),
            status: z.string()
          })
        )
        .optional()
        .describe("Optional sibling project repos to register in the Paired projects table."),
      force: z
        .boolean()
        .default(false)
        .describe("Override vault-specific collisions (existing wiki/ or vault-marked CLAUDE.md). Does not touch unrelated host-project files.")
    },
    async ({ vaultName, domain, pairedProjects, force }) => {
      const result = initVault({ cwd, vaultName, domain, pairedProjects, force });
      const lines: string[] = [
        `Vault initialized (${result.scenario}) at ${result.cwd}.`,
        ""
      ];
      if (result.createdDirs.length) {
        lines.push("Created directories:", ...result.createdDirs.map((d) => `  - ${d}/`), "");
      }
      if (result.createdFiles.length) {
        lines.push("Created files:", ...result.createdFiles.map((f) => `  - ${f}`), "");
      }
      if (result.appendedFiles.length) {
        lines.push("Appended vault schema to:", ...result.appendedFiles.map((f) => `  - ${f}`), "");
      }
      if (result.skippedFiles.length) {
        lines.push("Skipped (already vault-marked or present):", ...result.skippedFiles.map((f) => `  - ${f}`), "");
      }
      lines.push(
        "Next: drop source documents into raw/ and tell the agent `ingest raw/<file>` (or `ingest <url>`). The agent follows the schema in CLAUDE.md to summarize and integrate them into the wiki. Fetch the canonical operations prompt via the `bridge_vault_init_prompt` MCP prompt if needed."
      );
      return textResponse(lines.join("\n"));
    }
  );

  server.tool(
    "vault_status",
    "Report vault scaffold state in the current directory: which expected dirs/files exist, whether CLAUDE.md carries the vault marker, and which files in raw/ have no matching wiki/sources/<slug>.md (pending ingests).",
    {},
    async () => jsonResponse(vaultStatus(cwd))
  );

  return server;
}

export async function runMcpServer(cwd = process.cwd()): Promise<void> {
  const server = createHarnessBridgeServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
