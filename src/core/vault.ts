import fs from "node:fs";
import path from "node:path";

export const VAULT_MARKER_START = "<!-- harness-bridge:vault-schema -->";
export const VAULT_MARKER_END = "<!-- /harness-bridge:vault-schema -->";

export const VAULT_DIRS = [
  "raw",
  "raw/assets",
  "wiki",
  "wiki/entities",
  "wiki/concepts",
  "wiki/sources",
  "wiki/syntheses"
] as const;

export const VAULT_FILES = {
  claudeMd: "CLAUDE.md",
  agentsMd: "AGENTS.md",
  index: "wiki/index.md",
  log: "wiki/log.md"
} as const;

export interface PairedProject {
  name: string;
  path: string;
  purpose: string;
  status: string;
}

export interface InitVaultOptions {
  cwd: string;
  vaultName: string;
  domain?: string;
  pairedProjects?: PairedProject[];
  force?: boolean;
  today?: string;
}

export interface InitVaultResult {
  cwd: string;
  scenario: "standalone" | "co-located";
  createdDirs: string[];
  createdFiles: string[];
  appendedFiles: string[];
  skippedFiles: string[];
}

export interface VaultStatusResult {
  cwd: string;
  state: "not-a-vault" | "partial" | "complete";
  hasVaultMarker: boolean;
  dirs: Record<string, boolean>;
  files: Record<string, boolean>;
  pendingIngests: string[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderPairedProjectsSection(projects: PairedProject[] | undefined): string {
  if (!projects || projects.length === 0) {
    return [
      "## Paired projects",
      "",
      "_(none yet — add rows here as sibling project repos are spun up.)_",
      "",
      "| Project | Path | Purpose | Status |",
      "|---|---|---|---|"
    ].join("\n");
  }
  const rows = projects.map(
    (p) => `| ${p.name} | \`${p.path}\` | ${p.purpose} | ${p.status} |`
  );
  return [
    "## Paired projects",
    "",
    "| Project | Path | Purpose | Status |",
    "|---|---|---|---|",
    ...rows
  ].join("\n");
}

export function renderVaultClaudeMd(opts: {
  vaultName: string;
  domain?: string;
  pairedProjects?: PairedProject[];
}): string {
  const domainLine = opts.domain ? `\n<!-- domain: ${opts.domain} -->\n` : "";
  return `# LLM Wiki Agent — Schema (${opts.vaultName})
${domainLine}
You are the maintainer of this Obsidian-compatible knowledge vault. You write and maintain the wiki; the user curates sources and asks questions.

## Three layers

1. **\`raw/\`** — immutable source documents (articles, PDFs, transcripts, notes). You READ from here, never modify. Assets (images) live in \`raw/assets/\`.
2. **\`wiki/\`** — markdown pages YOU own and maintain. Subfolders:
   - \`wiki/entities/\` — people, organizations, products, places (one page per entity)
   - \`wiki/concepts/\` — ideas, theories, frameworks, methods
   - \`wiki/sources/\` — one summary page per ingested raw source
   - \`wiki/syntheses/\` — comparisons, analyses, thesis pages, query results worth keeping
3. **\`CLAUDE.md\` / \`AGENTS.md\`** — this schema. Co-evolves with the user.

## Core files

- **\`wiki/index.md\`** — catalog of every page, grouped by category, with one-line summaries. Update on every ingest.
- **\`wiki/log.md\`** — append-only chronological record. Each entry MUST start with \`## [YYYY-MM-DD] <op> | <title>\` so it's greppable. Ops: \`ingest\`, \`query\`, \`lint\`, \`schema\`.

## Page conventions

- Filenames: kebab-case (\`elon-musk.md\`, \`prospect-theory.md\`). Use the exact filename as the wiki link target.
- Every page begins with YAML frontmatter:
  \`\`\`yaml
  ---
  type: entity | concept | source | synthesis
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  sources: [source-slug-1, source-slug-2]
  tags: [tag1, tag2]
  ---
  \`\`\`
- Use \`[[wikilinks]]\` liberally — link any entity/concept mention to its page. Create stub pages for important new mentions rather than leaving dead links.
- Cite claims inline with \`[[sources/source-slug]]\`. Every non-obvious claim should be traceable to a source.
- When sources contradict, surface it explicitly in a **Contradictions** section on the affected page — don't silently pick one.

## Operations

### Ingest (\`ingest <path-or-url>\`)
1. Read the source end-to-end.
2. Briefly discuss key takeaways with the user before writing — surface anything surprising, contradictory, or worth emphasizing.
3. Write \`wiki/sources/<slug>.md\` with: metadata, 3-10 bullet key takeaways, notable quotes, open questions.
4. Update or create relevant \`entities/\` and \`concepts/\` pages — integrate new info, flag contradictions with existing claims.
5. Update \`wiki/index.md\`.
6. Append entry to \`wiki/log.md\`: \`## [DATE] ingest | <title>\` + 2-3 line summary of what changed.

### Query (\`<any question>\`)
1. Read \`wiki/index.md\` first to find relevant pages.
2. Drill into those pages, follow \`[[wikilinks]]\` as needed.
3. Answer with inline citations to wiki pages and ultimately to sources.
4. If the answer is substantive (comparison, analysis, novel synthesis), offer to file it as \`wiki/syntheses/<slug>.md\` so the insight compounds.
5. Log non-trivial queries.

### Lint (\`lint\`)
Health-check the wiki. Report:
- Contradictions between pages
- Stale claims newer sources have superseded
- Orphan pages (no inbound links)
- Important concepts mentioned but lacking their own page
- Missing cross-references
- Data gaps where a new source/web search would help
- Suggested next questions to investigate

## Style rules

- Wiki pages are reference material, not essays. Prefer bullets, short paragraphs, tables.
- Write to be re-read. Lead with the conclusion; expand below.
- Never invent facts. If sources don't cover something, say so explicitly (a \`## Gaps\` section is fine).
- Keep \`updated:\` frontmatter current whenever you touch a page.
- The user reads the wiki in Obsidian; favor formatting that renders well there.

${renderPairedProjectsSection(opts.pairedProjects)}

### When a session is asked to work on a paired project
1. Read the relevant \`wiki/syntheses/*\` pages and related concepts for design context.
2. Switch context to the project repo (\`cd <path>\` shown above).
3. From there, operate per the project's own \`CLAUDE.md\` / \`AGENTS.md\` — the project's instructions take over.
4. When substantive design decisions or learnings emerge during the work, reflect them back into the vault's relevant \`wiki/concepts/\` or \`wiki/syntheses/\` pages before finishing. Append a \`## [YYYY-MM-DD] feature | <title>\` entry to \`wiki/log.md\` recording the change.

## Workflow

The user keeps Obsidian open while you work. After each operation, give a short summary of pages touched so they can browse the changes. Don't ask for confirmation on routine bookkeeping (index/log updates) — just do it.
`;
}

export function renderVaultAgentsMd(): string {
  return "See `CLAUDE.md` for the LLM Wiki schema and operations.\n";
}

export function renderVaultIndexMd(vaultName: string): string {
  return `# ${vaultName} — Index

Catalog of every wiki page, grouped by category. Updated on every ingest.

## Entities

_(none yet)_

## Concepts

_(none yet)_

## Sources

_(none yet)_

## Syntheses

_(none yet)_
`;
}

export function renderVaultLogMd(date: string): string {
  return `# Log

Append-only chronological record. Each entry starts with \`## [YYYY-MM-DD] <op> | <title>\` so it's greppable.

## [${date}] schema | Vault initialized
- Created folder structure and schema files.
- Ready for first ingest.
`;
}

function fencedVaultSchema(claudeBody: string): string {
  return `${VAULT_MARKER_START}\n${claudeBody.trimEnd()}\n${VAULT_MARKER_END}\n`;
}

function fencedAgentsSchema(): string {
  return `${VAULT_MARKER_START}\n${renderVaultAgentsMd().trimEnd()}\n${VAULT_MARKER_END}\n`;
}

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readFileSafe(p: string): string {
  return fileExists(p) ? fs.readFileSync(p, "utf8") : "";
}

function applyFenced(target: string, fenced: string): "created" | "appended" | "skipped" {
  if (!fileExists(target)) {
    fs.writeFileSync(target, fenced, "utf8");
    return "created";
  }
  const existing = readFileSafe(target);
  if (existing.trim().length === 0) {
    fs.writeFileSync(target, fenced, "utf8");
    return "created";
  }
  if (existing.includes(VAULT_MARKER_START)) {
    return "skipped";
  }
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(target, `${existing}${separator}${fenced}`, "utf8");
  return "appended";
}

export function initVault(options: InitVaultOptions): InitVaultResult {
  const { cwd, vaultName, domain, pairedProjects, force = false } = options;
  const date = options.today ?? today();

  const wikiDir = path.join(cwd, "wiki");
  const claudePath = path.join(cwd, VAULT_FILES.claudeMd);
  const agentsPath = path.join(cwd, VAULT_FILES.agentsMd);

  const claudeExisting = readFileSafe(claudePath);
  const claudeHasMarker = claudeExisting.includes(VAULT_MARKER_START);

  if (!force) {
    if (fileExists(wikiDir)) {
      throw new Error(
        `Refusing to init vault: ${wikiDir} already exists. Pass force=true to override.`
      );
    }
    if (claudeHasMarker) {
      throw new Error(
        `Refusing to init vault: ${claudePath} already contains the vault marker. Pass force=true to override.`
      );
    }
  }

  const createdDirs: string[] = [];
  for (const dir of VAULT_DIRS) {
    const abs = path.join(cwd, dir);
    if (!fileExists(abs)) {
      fs.mkdirSync(abs, { recursive: true });
      createdDirs.push(dir);
    }
  }

  const createdFiles: string[] = [];
  const appendedFiles: string[] = [];
  const skippedFiles: string[] = [];

  const claudeBody = renderVaultClaudeMd({ vaultName, domain, pairedProjects });
  const fencedClaude = fencedVaultSchema(claudeBody);
  const fencedAgents = fencedAgentsSchema();

  const scenario: "standalone" | "co-located" = fileExists(claudePath) ? "co-located" : "standalone";

  const claudeAction = applyFenced(claudePath, fencedClaude);
  if (claudeAction === "created") createdFiles.push(VAULT_FILES.claudeMd);
  else if (claudeAction === "appended") appendedFiles.push(VAULT_FILES.claudeMd);
  else skippedFiles.push(VAULT_FILES.claudeMd);

  const agentsAction = applyFenced(agentsPath, fencedAgents);
  if (agentsAction === "created") createdFiles.push(VAULT_FILES.agentsMd);
  else if (agentsAction === "appended") appendedFiles.push(VAULT_FILES.agentsMd);
  else skippedFiles.push(VAULT_FILES.agentsMd);

  const indexPath = path.join(cwd, VAULT_FILES.index);
  if (!fileExists(indexPath)) {
    fs.writeFileSync(indexPath, renderVaultIndexMd(vaultName), "utf8");
    createdFiles.push(VAULT_FILES.index);
  } else {
    skippedFiles.push(VAULT_FILES.index);
  }

  const logPath = path.join(cwd, VAULT_FILES.log);
  if (!fileExists(logPath)) {
    fs.writeFileSync(logPath, renderVaultLogMd(date), "utf8");
    createdFiles.push(VAULT_FILES.log);
  } else {
    skippedFiles.push(VAULT_FILES.log);
  }

  return {
    cwd,
    scenario,
    createdDirs,
    createdFiles,
    appendedFiles,
    skippedFiles
  };
}

function listPendingIngests(cwd: string): string[] {
  const rawDir = path.join(cwd, "raw");
  const sourcesDir = path.join(cwd, "wiki", "sources");
  if (!fileExists(rawDir)) return [];

  const ingestedSlugs = new Set<string>();
  if (fileExists(sourcesDir)) {
    for (const entry of fs.readdirSync(sourcesDir)) {
      if (entry.endsWith(".md")) {
        ingestedSlugs.add(entry.replace(/\.md$/, ""));
      }
    }
  }

  const pending: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const relPath = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "assets") continue;
        walk(abs, relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const slug = entry.name.replace(/\.[^.]+$/, "");
      if (!ingestedSlugs.has(slug)) {
        pending.push(relPath);
      }
    }
  };
  walk(rawDir, "raw");
  return pending.sort();
}

export function vaultStatus(cwd: string): VaultStatusResult {
  const dirs: Record<string, boolean> = {};
  for (const dir of VAULT_DIRS) {
    dirs[dir] = fileExists(path.join(cwd, dir));
  }
  const files: Record<string, boolean> = {};
  for (const [key, rel] of Object.entries(VAULT_FILES)) {
    files[key] = fileExists(path.join(cwd, rel));
  }

  const claudeContent = readFileSafe(path.join(cwd, VAULT_FILES.claudeMd));
  const hasVaultMarker = claudeContent.includes(VAULT_MARKER_START);

  const allDirs = Object.values(dirs).every(Boolean);
  const allFiles = Object.values(files).every(Boolean);
  const noneDirs = Object.values(dirs).every((v) => !v);
  const noneFiles = Object.values(files).every((v) => !v);

  let state: VaultStatusResult["state"];
  if (allDirs && allFiles && hasVaultMarker) {
    state = "complete";
  } else if (noneDirs && noneFiles && !hasVaultMarker) {
    state = "not-a-vault";
  } else {
    state = "partial";
  }

  return {
    cwd,
    state,
    hasVaultMarker,
    dirs,
    files,
    pendingIngests: listPendingIngests(cwd)
  };
}
