import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  getGitState,
  getRepoRoot,
  gitDiffFromHead,
  gitLogRange,
  gitPath,
  gitStatusForFile,
  isIgnoredByGit
} from "./git.js";
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

export const NOTES_SECTION = "Notes for the next agent";
export const FOCUS_SECTION = "Next session focus";
export const REFERENCES_SECTION = "References";
export const SUGGESTED_SKILLS_SECTION = "Suggested skills";

// Canonical order of every known section. Optional sections (focus, references,
// suggested skills, notes) are only rendered when they have content, except notes,
// which v1 has always rendered.
const ALL_SECTIONS = [
  "Goal",
  FOCUS_SECTION,
  "Plan",
  "Next action",
  "Decisions & rationale",
  "Open questions",
  "Files touched",
  REFERENCES_SECTION,
  SUGGESTED_SKILLS_SECTION,
  NOTES_SECTION
];
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

// Values that are references to a secret rather than the secret itself
// (placeholders, env lookups, already-redacted markers).
const NOT_A_LITERAL = String.raw`(?![<$\{\[(]|process\.env|os\.environ|env\.|REDACTED)`;

const SECRET_RULES: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  {
    label: "private key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  { label: "API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED_API_KEY]" },
  { label: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { label: "GitHub token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { label: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, replacement: "[REDACTED_NPM_TOKEN]" },
  { label: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
  { label: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replacement: "[REDACTED_SLACK_TOKEN]" },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: "[REDACTED_GOOGLE_KEY]" },
  {
    label: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replacement: "[REDACTED_JWT]"
  },
  { label: "bearer token", pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi, replacement: "$1[REDACTED]" },
  {
    label: "URL credentials",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi,
    replacement: "$1[REDACTED]@"
  },
  {
    label: "credential assignment",
    pattern: new RegExp(
      String.raw`\b([A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key)[A-Za-z0-9_-]*\s*[:=]\s*)` +
        NOT_A_LITERAL +
        String.raw`(?!\d+\b)[^\s"'\`]{6,}`,
      "gi"
    ),
    replacement: "$1[REDACTED]"
  }
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

export function findSecrets(text: string): string[] {
  const found = new Set<string>();
  for (const rule of SECRET_RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      found.add(rule.label);
    }
    rule.pattern.lastIndex = 0;
  }
  return [...found];
}

function assertNoCredentialShapedContent(doc: BridgeDocument): void {
  const found = findSecrets(renderBridge(doc));
  if (found.length > 0) {
    throw new Error(
      `Refusing to write .harness/bridge.md because it contains credential-shaped content (${found.join(", ")}). Redact it and reference where the value lives instead.`
    );
  }
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
    const isRequired = REQUIRED_SECTIONS.includes(section);
    const value = doc.sections[section];
    if (!isRequired && section !== NOTES_SECTION && !value?.trim()) {
      continue;
    }
    lines.push(`## ${section}`, (value ?? (isRequired ? "_(none)_" : "")).trimEnd(), "");
  }

  // Forward compatibility: keep sections this version does not know about.
  for (const [section, value] of Object.entries(doc.sections)) {
    if (!ALL_SECTIONS.includes(section)) {
      lines.push(`## ${section}`, value.trimEnd(), "");
    }
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
  const validation = validateBridge(rendered);
  if (!validation.valid) {
    throw new Error(`Refusing to write invalid bridge: ${validation.errors.join("; ")}`);
  }
  assertNoCredentialShapedContent(doc);
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
      [NOTES_SECTION]: ""
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

function setOptionalSection(doc: BridgeDocument, section: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    doc.sections[section] = trimmed;
  } else {
    delete doc.sections[section];
  }
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
  if (options.notes !== undefined) next.sections[NOTES_SECTION] = options.notes.trim();
  if (options.focus !== undefined) setOptionalSection(next, FOCUS_SECTION, options.focus);
  if (options.references !== undefined) setOptionalSection(next, REFERENCES_SECTION, options.references);
  if (options.suggestedSkills !== undefined) setOptionalSection(next, SUGGESTED_SKILLS_SECTION, options.suggestedSkills);

  writeBridge(options.cwd, next);
  return next;
}

export function getStatus(cwd: string): StatusResult {
  const git = getGitState(cwd);
  const file = bridgePath(cwd);
  const exists = fs.existsSync(file);
  const ignoredByGit = isIgnoredByGit(cwd, BRIDGE_RELATIVE_PATH);
  if (!exists) {
    return { exists, path: file, git, ignoredByGit, discrepancies: ["Bridge file is missing."] };
  }

  const markdown = fs.readFileSync(file, "utf8");
  const validation = validateBridge(markdown);
  let bridge: BridgeDocument | undefined;
  try {
    bridge = parseBridge(markdown);
  } catch {
    return { exists, path: file, validation, git, ignoredByGit, discrepancies: ["Bridge file is present but cannot be parsed."] };
  }
  const discrepancies: string[] = [];

  if (bridge.frontmatter.repo !== git.repo) discrepancies.push(`repo: bridge=${bridge.frontmatter.repo} git=${git.repo}`);
  if (bridge.frontmatter.branch !== git.branch) discrepancies.push(`branch: bridge=${bridge.frontmatter.branch} git=${git.branch}`);
  if (bridge.frontmatter.head !== git.head) discrepancies.push(`head: bridge=${bridge.frontmatter.head} git=${git.head}`);
  if (bridge.frontmatter.dirty !== git.dirty) discrepancies.push(`dirty: bridge=${bridge.frontmatter.dirty} git=${git.dirty}`);

  const gitLogSinceBridgeHead = bridge.frontmatter.head !== git.head ? gitLogRange(cwd, bridge.frontmatter.head) : "";
  const fileGrounding = extractFilesTouched(bridge.sections["Files touched"]).map((touchedFile) => ({
    file: touchedFile,
    diffFromBridgeHead: gitDiffFromHead(cwd, bridge.frontmatter.head, touchedFile),
    status: gitStatusForFile(cwd, touchedFile)
  }));

  return { exists, path: file, validation, bridge, git, ignoredByGit, discrepancies, gitLogSinceBridgeHead, fileGrounding };
}

function extractFilesTouched(filesTouched: string | undefined): string[] {
  if (!filesTouched || filesTouched.trim() === "_(none)_") {
    return [];
  }

  const files = new Set<string>();
  for (const line of filesTouched.split("\n")) {
    const backtickMatch = line.match(/`([^`]+)`/);
    if (backtickMatch) {
      files.add(backtickMatch[1]);
      continue;
    }

    const bulletPath = line.match(/^[-*]\s+([^\s]+)\s+/);
    if (bulletPath) {
      files.add(bulletPath[1]);
    }
  }
  return [...files];
}

export function summarizeForConsume(cwd: string): string {
  const status = getStatus(cwd);
  if (!status.exists || !status.bridge) {
    return "No .harness/bridge.md exists. Run bridge_recover or bridge_init before consuming.";
  }

  const bridge = status.bridge;
  const discrepancyText =
    status.discrepancies.length > 0 ? `\n\nDiscrepancies:\n${status.discrepancies.map((item) => `- ${item}`).join("\n")}` : "";
  const gitLogText = status.gitLogSinceBridgeHead
    ? `Git commits since bridge head:\n${status.gitLogSinceBridgeHead}`
    : "";
  const groundingText =
    status.fileGrounding && status.fileGrounding.length > 0
      ? `File grounding:\n${status.fileGrounding
          .map((item) => {
            const details = [
              `- ${item.file}`,
              item.status ? `  status: ${item.status}` : "",
              item.diffFromBridgeHead ? `  diff from bridge head:\n${indent(item.diffFromBridgeHead, "  ")}` : "  diff from bridge head: _(none)_"
            ].filter(Boolean);
            return details.join("\n");
          })
          .join("\n")}`
      : "";

  const optional = (label: string, section: string) => {
    const value = bridge.sections[section]?.trim();
    return value && value !== "_(none)_" && value !== "_(none yet)_" ? `${label}:\n${value}` : "";
  };
  const skillsHint = optional("Suggested skills", SUGGESTED_SKILLS_SECTION)
    ? "Load the suggested skills (or the closest equivalents available to you) before starting the next action."
    : "";

  return [
    `Goal:\n${bridge.sections.Goal}`,
    optional("Next session focus", FOCUS_SECTION),
    `Done / plan:\n${bridge.sections.Plan}`,
    `Next action:\n${bridge.sections["Next action"]}`,
    optional("Decisions already made (do not re-decide)", "Decisions & rationale"),
    optional("Open questions", "Open questions"),
    `Files touched:\n${bridge.sections["Files touched"]}`,
    optional("References (read these instead of guessing)", REFERENCES_SECTION),
    optional("Suggested skills", SUGGESTED_SKILLS_SECTION),
    optional("Notes for the next agent", NOTES_SECTION),
    gitLogText,
    groundingText,
    skillsHint,
    "Stop here and wait for explicit user confirmation before executing the next action.",
    discrepancyText.trim()
  ]
    .filter(Boolean)
    .join("\n\n");
}

function indent(text: string, prefix: string): string {
  return text
    .trimEnd()
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function redactSecrets(text: string): string {
  return SECRET_RULES.reduce((result, rule) => {
    rule.pattern.lastIndex = 0;
    return result.replace(rule.pattern, rule.replacement);
  }, text);
}

/**
 * Keep the bridge out of git without touching the shared .gitignore, by adding
 * `.harness/` to this clone's `.git/info/exclude`. Returns the exclude file path.
 */
export function excludeBridgeFromGit(cwd: string): string {
  const excludeFile = gitPath(cwd, "info/exclude");
  if (!excludeFile) {
    throw new Error("Cannot keep the bridge local-only: this directory is not inside a git repository.");
  }
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
  const alreadyExcluded = existing.split("\n").some((line) => [".harness", ".harness/", "/.harness", "/.harness/"].includes(line.trim()));
  if (!alreadyExcluded) {
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(excludeFile, `${existing}${separator}# Harness Bridge (local-only handoffs)\n/.harness/\n`, "utf8");
  }
  return excludeFile;
}
