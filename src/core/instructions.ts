import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "./git.js";

/** Rules files the maintainer snippet can be installed into. */
export const RULES_TARGETS = ["claude-code", "codex", "antigravity", "gemini-cli", "cursor"] as const;
export type RulesTarget = (typeof RULES_TARGETS)[number];

export const MAINTAINER_HEADER = "## Harness Bridge — keep .harness/bridge.md current";

const MAINTAINER_PROMPT = new URL("../../prompts/maintainer.md", import.meta.url);

export function maintainerSnippet(): string {
  const maintainer = fs.readFileSync(MAINTAINER_PROMPT, "utf8");
  const match = maintainer.match(/--- begin snippet ---\n([\s\S]*?)\n--- end snippet ---/);
  if (!match) throw new Error("Could not find maintainer snippet markers in prompts/maintainer.md.");
  return match[1].trimEnd();
}

export function parseRulesTarget(value: string): RulesTarget {
  const normalized = value.toLowerCase() === "claude" ? "claude-code" : value.toLowerCase() === "gemini" ? "gemini-cli" : value.toLowerCase();
  if (!(RULES_TARGETS as readonly string[]).includes(normalized)) {
    throw new Error(`Unknown rules target "${value}". Use: ${RULES_TARGETS.join(", ")}.`);
  }
  return normalized as RulesTarget;
}

/** Append the maintainer snippet once (idempotent, keyed on the §7 header). Returns a status line. */
export function installMaintainerRules(cwd: string, target: RulesTarget): string {
  const root = getRepoRoot(cwd);
  const snippet = maintainerSnippet();

  if (target === "cursor") {
    const cursorRule = path.join(root, ".cursor/rules/harness-bridge.md");
    if (fs.existsSync(cursorRule) && fs.readFileSync(cursorRule, "utf8").includes(MAINTAINER_HEADER)) {
      return `${cursorRule} already contains Harness Bridge instructions.`;
    }
    fs.mkdirSync(path.dirname(cursorRule), { recursive: true });
    fs.writeFileSync(cursorRule, `${snippet}\n`, "utf8");
    return `Created ${cursorRule}.`;
  }

  const file = target === "claude-code" ? "CLAUDE.md" : target === "gemini-cli" ? "GEMINI.md" : "AGENTS.md";
  const destination = path.join(root, file);
  const existing = fs.existsSync(destination) ? fs.readFileSync(destination, "utf8") : "";
  if (existing.includes(MAINTAINER_HEADER)) return `${destination} already contains Harness Bridge instructions.`;
  const separator = existing.trim().length > 0 ? "\n\n" : "";
  fs.writeFileSync(destination, `${existing.trimEnd()}${separator}${snippet}\n`, "utf8");
  return `Updated ${destination}.`;
}
