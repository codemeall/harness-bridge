import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
import fs from "node:fs";

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

export function createHarnessBridgeServer(cwd = process.cwd()): McpServer {
  const server = new McpServer(
    {
      name: "harness-bridge",
      version: "0.1.0"
    },
    {
      instructions:
        "Use Harness Bridge tools to maintain .harness/bridge.md for serial AI coding-agent handoffs. The bridge file remains the source of truth. After bridge_consume, restate the returned state and wait for user confirmation before executing."
    }
  );

  server.tool(
    "bridge_status",
    "Read .harness/bridge.md, validate it, and compare frontmatter against current git state.",
    {},
    async () => jsonResponse(getStatus(cwd))
  );

  server.tool(
    "bridge_validate",
    "Validate a bridge markdown string, or validate the current repo bridge when markdown is omitted.",
    {
      markdown: z.string().optional()
    },
    async ({ markdown }) => {
      const file = bridgePath(cwd);
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
      cadence: z.enum(["checkpoint", "lazy", "aggressive"]).default("checkpoint")
    },
    async ({ title, goal, plan, nextAction, generatedBy, cadence }) => {
      const doc = initBridge({ cwd, title, goal, plan, nextAction, generatedBy, cadence });
      return textResponse(renderBridge(doc));
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
      cadence: z.enum(["checkpoint", "lazy", "aggressive"]).optional()
    },
    async (args) => {
      const doc = checkpointBridge({ cwd, ...args });
      return textResponse(renderBridge(doc));
    }
  );

  server.tool(
    "bridge_produce",
    "Finalize the bridge before a deliberate handoff. Same patch behavior as bridge_checkpoint, with handoff-oriented wording.",
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
      cadence: z.enum(["checkpoint", "lazy", "aggressive"]).optional()
    },
    async (args) => {
      const doc = checkpointBridge({ cwd, ...args });
      return textResponse(renderBridge(doc));
    }
  );

  server.tool(
    "bridge_consume",
    "Return grounded bridge state for a fresh session. The caller must restate it and wait for user confirmation before acting.",
    {},
    async () => textResponse(summarizeForConsume(cwd))
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
      write: z.boolean().default(false).describe("Set true only after user confirmation.")
    },
    async ({ mode, recoveredBridgeMarkdown, transcriptText, write }) => {
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

      writeBridge(cwd, parseBridge(recoveredBridgeMarkdown));
      return jsonResponse({ written: true, validation });
    }
  );

  return server;
}

export async function runMcpServer(cwd = process.cwd()): Promise<void> {
  const server = createHarnessBridgeServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
