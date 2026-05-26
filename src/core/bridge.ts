import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { getGitState, getRepoRoot } from "./git.js";
import type {
  BridgeDocument,
  BridgeFrontmatter,
  CheckpointOptions,
  GitState,
  InitOptions,
  StatusResult,
  ValidationResult
} from "./types.js";

export const BRIDGE_SCHEMA = "harness-bridge/v1";
export const BRIDGE_RELATIVE_PATH = ".harness/bridge.md";

export const REQUIRED_SECTIONS = [
  "Goal",
  "Plan",
  "Next action",
  "Decisions & rationale",
  "Open questions",
  "Files touched"
];

const OPTIONAL_SECTIONS = ["Notes for the next agent"];
const ALL_SECTIONS = [...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS];
const REQUIRED_FRONTMATTER = [
  "schema",
  "generated_by",
  "generated_at",
  "last_updated",
  "cadence",
  "repo",
  "branch",
  "head",
  "dirty"
];

export function bridgePath(cwd: string): string {
  return path.join(getRepoRoot(cwd), BRIDGE_RELATIVE_PATH);
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function normalizePlaceholder(value?: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "_(none)_";
}

function ensurePlanLegend(plan: string): string {
  const trimmed = normalizePlaceholder(plan);
  if (trimmed.includes("Legend: [x] done")) {
    return trimmed;
  }
  return `${trimmed}\n\nLegend: [x] done · [~] in progress · [ ] pending`;
}

function renderFrontmatter(frontmatter: BridgeFrontmatter): string {
  const ordered: Record<string, unknown> = {};
  for (const key of REQUIRED_FRONTMATTER) {
    ordered[key] = frontmatter[key];
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in ordered)) {
      ordered[key] = value;
    }
  }
  return YAML.stringify(ordered).trimEnd();
}

export function renderBridge(doc: BridgeDocument): string {
  const lines: string[] = [
    "---",
    renderFrontmatter(doc.frontmatter),
    "---",
    "",
    `# Bridge — ${doc.title.trim()}`,
    ""
  ];

  for (const section of ALL_SECTIONS) {
    const value = doc.sections[section] ?? (section === "Notes for the next agent" ? "" : "_(none)_");
    lines.push(`## ${section}`, value.trimEnd(), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function parseBridge(markdown: string): BridgeDocument {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Bridge must start with YAML frontmatter.");
  }

  const parsed = YAML.parse(match[1]) as Record<string, unknown>;
  const body = match[2].trimStart();
  const titleMatch = body.match(/^# Bridge — (.+)$/m);
  if (!titleMatch) {
    throw new Error("Bridge must include '# Bridge — <title>'.");
  }

  const sections: Record<string, string> = {};
  const headingPattern = /^## (.+)$/gm;
  const matches = [...body.matchAll(headingPattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const name = current[1].trim();
    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? body.length;
    sections[name] = body.slice(start, end).trim();
  }

  return {
    frontmatter: parsed as BridgeFrontmatter,
    title: titleMatch[1].trim(),
    sections
  };
}

export function validateBridge(markdown: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let doc: BridgeDocument;

  try {
    doc = parseBridge(markdown);
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings
    };
  }

  for (const key of REQUIRED_FRONTMATTER) {
    if (!(key in doc.frontmatter)) {
      errors.push(`Missing required frontmatter field: ${key}`);
    }
  }

  if (doc.frontmatter.schema !== BRIDGE_SCHEMA) {
    errors.push(`Unsupported schema: ${String(doc.frontmatter.schema)}`);
  }

  if (!["checkpoint", "lazy", "aggressive"].includes(String(doc.frontmatter.cadence))) {
    errors.push(`Invalid cadence: ${String(doc.frontmatter.cadence)}`);
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!(section in doc.sections)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  const actualOrder = Object.keys(doc.sections).filter((section) => ALL_SECTIONS.includes(section));
  const requiredOrder = ALL_SECTIONS.filter((section) => section in doc.sections);
  if (actualOrder.join("\n") !== requiredOrder.join("\n")) {
    errors.push("Bridge sections are not in harness-bridge/v1 order.");
  }

  for (const section of REQUIRED_SECTIONS) {
    if (doc.sections[section]?.trim().length === 0) {
      warnings.push(`Required section is empty: ${section}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function readBridge(cwd: string): BridgeDocument | undefined {
  const file = bridgePath(cwd);
  if (!fs.existsSync(file)) {
    return undefined;
  }
  return parseBridge(fs.readFileSync(file, "utf8"));
}

export function writeBridge(cwd: string, doc: BridgeDocument): string {
  const file = bridgePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rendered = renderBridge(doc);
  fs.writeFileSync(file, rendered, "utf8");
  return rendered;
}

function frontmatterFromGit(git: GitState, generatedBy: string, cadence = "checkpoint"): BridgeFrontmatter {
  const timestamp = nowIso();
  return {
    schema: BRIDGE_SCHEMA,
    generated_by: generatedBy,
    generated_at: timestamp,
    last_updated: timestamp,
    cadence: cadence as BridgeFrontmatter["cadence"],
    repo: git.repo,
    branch: git.branch,
    head: git.head,
    dirty: git.dirty
  };
}

export function initBridge(options: InitOptions): BridgeDocument {
  const git = getGitState(options.cwd);
  const existing = readBridge(options.cwd);
  if (existing) {
    return existing;
  }

  const doc: BridgeDocument = {
    frontmatter: frontmatterFromGit(git, options.generatedBy, options.cadence),
    title: options.title,
    sections: {
      Goal: normalizePlaceholder(options.goal),
      Plan: ensurePlanLegend(options.plan ?? "- [ ] Define the work\n- [ ] Implement the change\n- [ ] Verify the result"),
      "Next action": normalizePlaceholder(options.nextAction ?? "Confirm the goal and replace this starter bridge with the first concrete next action."),
      "Decisions & rationale": "_(none)_",
      "Open questions": "_(none)_",
      "Files touched": "_(none)_",
      "Notes for the next agent": ""
    }
  };

  writeBridge(options.cwd, doc);
  return doc;
}

function appendDecisions(existing: string, additions: string[]): string {
  const cleaned = additions.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return existing;
  }
  const prefix = existing.trim() === "_(none)_" || existing.trim() === "_(none yet)_" ? "" : `${existing.trimEnd()}\n`;
  return `${prefix}${cleaned.map((item) => (item.startsWith("- ") ? item : `- ${item}`)).join("\n")}`;
}

export function checkpointBridge(options: CheckpointOptions): BridgeDocument {
  const git = getGitState(options.cwd);
  const existing = readBridge(options.cwd);
  if (!existing) {
    throw new Error("No .harness/bridge.md exists. Run bridge_init first.");
  }

  const next: BridgeDocument = {
    frontmatter: {
      ...existing.frontmatter,
      generated_by: existing.frontmatter.generated_by,
      last_updated: nowIso(),
      cadence: options.cadence ?? existing.frontmatter.cadence,
      repo: git.repo,
      branch: git.branch,
      head: git.head,
      dirty: git.dirty
    },
    title: options.title?.trim() || existing.title,
    sections: { ...existing.sections }
  };

  if (options.goal !== undefined) next.sections.Goal = normalizePlaceholder(options.goal);
  if (options.plan !== undefined) next.sections.Plan = ensurePlanLegend(options.plan);
  if (options.nextAction !== undefined) next.sections["Next action"] = normalizePlaceholder(options.nextAction);
  if (options.decisionsToAppend) {
    next.sections["Decisions & rationale"] = appendDecisions(
      next.sections["Decisions & rationale"] ?? "_(none)_",
      options.decisionsToAppend
    );
  }
  if (options.openQuestions !== undefined) next.sections["Open questions"] = normalizePlaceholder(options.openQuestions);
  if (options.filesTouched !== undefined) next.sections["Files touched"] = normalizePlaceholder(options.filesTouched);
  if (options.notes !== undefined) next.sections["Notes for the next agent"] = options.notes.trim();

  writeBridge(options.cwd, next);
  return next;
}

export function getStatus(cwd: string): StatusResult {
  const git = getGitState(cwd);
  const file = bridgePath(cwd);
  const exists = fs.existsSync(file);
  if (!exists) {
    return { exists, path: file, git, discrepancies: ["Bridge file is missing."] };
  }

  const markdown = fs.readFileSync(file, "utf8");
  const validation = validateBridge(markdown);
  let bridge: BridgeDocument | undefined;
  try {
    bridge = parseBridge(markdown);
  } catch {
    return { exists, path: file, validation, git, discrepancies: ["Bridge file is present but cannot be parsed."] };
  }
  const discrepancies: string[] = [];

  if (bridge.frontmatter.repo !== git.repo) discrepancies.push(`repo: bridge=${bridge.frontmatter.repo} git=${git.repo}`);
  if (bridge.frontmatter.branch !== git.branch) discrepancies.push(`branch: bridge=${bridge.frontmatter.branch} git=${git.branch}`);
  if (bridge.frontmatter.head !== git.head) discrepancies.push(`head: bridge=${bridge.frontmatter.head} git=${git.head}`);
  if (bridge.frontmatter.dirty !== git.dirty) discrepancies.push(`dirty: bridge=${bridge.frontmatter.dirty} git=${git.dirty}`);

  return { exists, path: file, validation, bridge, git, discrepancies };
}

export function summarizeForConsume(cwd: string): string {
  const status = getStatus(cwd);
  if (!status.exists || !status.bridge) {
    return "No .harness/bridge.md exists. Run bridge_recover or bridge_init before consuming.";
  }

  const bridge = status.bridge;
  const discrepancyText =
    status.discrepancies.length > 0 ? `\n\nDiscrepancies:\n${status.discrepancies.map((item) => `- ${item}`).join("\n")}` : "";

  return [
    `Goal:\n${bridge.sections.Goal}`,
    `Done / plan:\n${bridge.sections.Plan}`,
    `Next action:\n${bridge.sections["Next action"]}`,
    `Files touched:\n${bridge.sections["Files touched"]}`,
    "Stop here and wait for explicit user confirmation before executing the next action.",
    discrepancyText.trim()
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/\b([A-Za-z0-9_-]*token[A-Za-z0-9_-]*\s*[:=]\s*)[^\s"'`]+/gi, "$1[REDACTED]")
    .replace(/\b([A-Za-z0-9_-]*password[A-Za-z0-9_-]*\s*[:=]\s*)[^\s"'`]+/gi, "$1[REDACTED]")
    .replace(/\b([A-Za-z0-9_-]*api[_-]?key[A-Za-z0-9_-]*\s*[:=]\s*)[^\s"'`]+/gi, "$1[REDACTED]");
}
