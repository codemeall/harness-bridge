import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_VERSION } from "./version.js";

/** Skills shipped in the package's `skills/` directory. */
export const BUNDLED_SKILLS = ["harness-bridge", "handoff", "pickup", "recover-session"] as const;

export type SkillAgent = "claude-code" | "codex" | "cursor" | "opencode" | "antigravity" | "antigravity-cli" | "gemini-cli";
export type SkillScope = "global" | "project";

/** Written inside every skill directory this installer creates; marks it as ours and records what was installed. */
export const SKILL_MANIFEST = ".harness-bridge.json";

interface SkillManifest {
  package: "@codemeall/harness-bridge";
  version: string;
  /** Hash of the skill files (manifest excluded) at install time; a mismatch means the user edited them. */
  hash: string;
}

/**
 * Content hashes of skills shipped by earlier releases, which wrote no manifest.
 * An installed copy matching one of these is an untouched old version and safe to update.
 */
const PREVIOUS_RELEASE_HASHES: Record<string, string[]> = {
  // 0.3.0
  handoff: ["7507f438b79c1da001b6625f6a9622eb61666002c8369820cf50eb83a87c7f6b"],
  "harness-bridge": ["e307fc6b3d51d880c0cac4abd1726b2dba988f4f9016db7d3886aaba7fb62bc4"],
  pickup: ["ae2bc9d552660bf54c97886c118698d99c616e37624e9635b6186fd1eac1bcb4"]
};

const home = (homeDir?: string) => homeDir ?? os.homedir();

/**
 * Where each agent loads skills from (checked against each product's docs, 2026-10):
 * - claude-code: Claude Code CLI and the desktop app's Code tab share `~/.claude/skills` / `.claude/skills`.
 * - codex: Codex CLI, IDE extension and the ChatGPT desktop app read `~/.agents/skills` / `.agents/skills`.
 * - cursor: `~/.cursor/skills`; project `.agents/skills` (Cursor also reads `.cursor/skills`).
 * - opencode: `$XDG_CONFIG_HOME/opencode/skills` (default `~/.config/opencode/skills`); project `.agents/skills`.
 * - antigravity: Antigravity app/IDE `~/.gemini/config/skills`; antigravity-cli: `agy` `~/.gemini/antigravity-cli/skills`; both read `.agents/skills`.
 * - gemini-cli: legacy Gemini CLI.
 */
const AGENT_SKILL_DIRS: Record<SkillAgent, { global: (homeDir?: string) => string; project: string; label: string }> = {
  "claude-code": {
    label: "Claude Code (CLI + desktop)",
    global: (h) => (h === undefined && process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, "skills") : path.join(home(h), ".claude/skills")),
    project: ".claude/skills"
  },
  codex: { label: "Codex / ChatGPT desktop", global: (h) => path.join(home(h), ".agents/skills"), project: ".agents/skills" },
  cursor: { label: "Cursor", global: (h) => path.join(home(h), ".cursor/skills"), project: ".agents/skills" },
  opencode: {
    label: "OpenCode",
    global: (h) => (h === undefined && process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "opencode/skills") : path.join(home(h), ".config/opencode/skills")),
    project: ".agents/skills"
  },
  antigravity: { label: "Antigravity app/IDE", global: (h) => path.join(home(h), ".gemini/config/skills"), project: ".agents/skills" },
  "antigravity-cli": { label: "Antigravity CLI (agy)", global: (h) => path.join(home(h), ".gemini/antigravity-cli/skills"), project: ".agents/skills" },
  "gemini-cli": { label: "Gemini CLI (legacy)", global: (h) => path.join(home(h), ".gemini/skills"), project: ".agents/skills" }
};

export const SKILL_AGENTS = Object.keys(AGENT_SKILL_DIRS) as SkillAgent[];

const AGENT_ALIASES: Record<string, SkillAgent> = {
  claude: "claude-code",
  chatgpt: "codex",
  agy: "antigravity-cli",
  gemini: "gemini-cli"
};

export function parseSkillAgent(value: string): SkillAgent {
  const id = (AGENT_ALIASES[value.toLowerCase()] ?? value.toLowerCase()) as SkillAgent;
  if (!SKILL_AGENTS.includes(id)) {
    throw new Error(`Unknown agent "${value}". Use one of: ${SKILL_AGENTS.join(", ")} (aliases: claude, chatgpt, agy), or pass --dir.`);
  }
  return id;
}

export function agentLabel(agent: SkillAgent): string {
  return AGENT_SKILL_DIRS[agent].label;
}

/** Agents that look installed on this machine (their config folder exists). */
export function detectSkillAgents(homeDir?: string): SkillAgent[] {
  const h = home(homeDir);
  const exists = (rel: string) => fs.existsSync(path.join(h, rel));
  const found: SkillAgent[] = [];
  if (exists(".claude") || (homeDir === undefined && process.env.CLAUDE_CONFIG_DIR && fs.existsSync(process.env.CLAUDE_CONFIG_DIR))) found.push("claude-code");
  if (exists(".codex") || exists(".agents")) found.push("codex");
  if (exists(".cursor")) found.push("cursor");
  if (exists(".config/opencode")) found.push("opencode");
  if (exists(".gemini/config") || exists(".gemini/antigravity")) found.push("antigravity");
  if (exists(".gemini/antigravity-cli")) found.push("antigravity-cli");
  return found;
}

/** Agents that also read Claude Code's and Codex's global skill folders (per their docs). */
const READS_SHARED_FOLDERS: SkillAgent[] = ["cursor", "opencode"];

/**
 * Drop agents whose global skills would be duplicated: Cursor and OpenCode
 * already load `~/.claude/skills` and `~/.agents/skills`.
 */
export function withoutDuplicateTargets(agents: SkillAgent[]): { agents: SkillAgent[]; covered: SkillAgent[] } {
  const shared = agents.includes("claude-code") || agents.includes("codex");
  const covered = shared ? agents.filter((agent) => READS_SHARED_FOLDERS.includes(agent)) : [];
  return { agents: agents.filter((agent) => !covered.includes(agent)), covered };
}

export interface SkillInstallOptions {
  agent?: SkillAgent;
  scope?: SkillScope;
  /** Explicit target directory; overrides agent/scope. */
  dir?: string;
  cwd?: string;
  homeDir?: string;
  force?: boolean;
}

export interface SkillInstallResult {
  targetDir: string;
  /** Newly installed, or already identical to the bundled version. */
  installed: string[];
  /** Replaced an older, unmodified copy installed by this tool. */
  updated: string[];
  /** Left alone: a different skill, a locally edited copy, or one managed by another installer. */
  skipped: string[];
  removed: string[];
  /** Why each skipped skill was skipped. */
  reasons: Record<string, string>;
}

export function bundledSkillsDir(): string {
  return fileURLToPath(new URL("../../skills/", import.meta.url));
}

export function resolveSkillsTarget(options: SkillInstallOptions): string {
  const cwd = options.cwd ?? process.cwd();
  if (options.dir) return path.resolve(cwd, options.dir);
  const dirs = AGENT_SKILL_DIRS[options.agent ?? "claude-code"];
  if (!dirs) throw new Error(`Unknown agent "${options.agent}". Use one of: ${SKILL_AGENTS.join(", ")}, or pass --dir.`);
  return (options.scope ?? "global") === "global" ? dirs.global(options.homeDir) : path.join(cwd, dirs.project);
}

function listFiles(dir: string, base = dir): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(full, base);
      return entry.name === SKILL_MANIFEST ? [] : [path.relative(base, full)];
    })
    .sort();
}

/** Content hash of a skill directory, ignoring our manifest. */
export function skillTreeHash(dir: string): string {
  const hash = createHash("sha256");
  for (const rel of listFiles(dir)) {
    hash.update(rel.split(path.sep).join("/")).update("\0").update(fs.readFileSync(path.join(dir, rel))).update("\0");
  }
  return hash.digest("hex");
}

function readManifest(dir: string): SkillManifest | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, SKILL_MANIFEST), "utf8"));
    return parsed?.package === "@codemeall/harness-bridge" && typeof parsed.hash === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isHarnessBridgeSkill(dir: string, name: string): boolean {
  const skillFile = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillFile)) return false;
  const content = fs.readFileSync(skillFile, "utf8");
  return new RegExp(`^name:\\s*${name}\\s*$`, "m").test(content) && /Harness Bridge/.test(content);
}

export type SkillState = "missing" | "current" | "outdated" | "modified" | "foreign" | "external";

export interface SkillStatus {
  skill: string;
  path: string;
  state: SkillState;
  installedVersion?: string;
  bundledVersion: string;
}

/**
 * - current: identical to the bundled skill
 * - outdated: installed by this tool, unmodified, older content → safe to update
 * - modified: installed by this tool, then edited locally
 * - external: a symlink, i.e. managed by another installer such as `npx skills`
 * - foreign: same name, not installed by this tool
 */
export function skillStatus(targetDir: string, skill: string): SkillStatus {
  const dir = path.join(targetDir, skill);
  const base = { skill, path: dir, bundledVersion: PACKAGE_VERSION };
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    return { ...base, state: "missing" };
  }
  const manifest = stat.isSymbolicLink() ? undefined : readManifest(dir);
  const installedHash = fs.existsSync(dir) ? skillTreeHash(dir) : "";
  if (installedHash === skillTreeHash(path.join(bundledSkillsDir(), skill))) {
    return { ...base, state: "current", installedVersion: manifest?.version ?? PACKAGE_VERSION };
  }
  if (stat.isSymbolicLink()) return { ...base, state: "external" };
  if (!manifest) {
    return PREVIOUS_RELEASE_HASHES[skill]?.includes(installedHash) ? { ...base, state: "outdated", installedVersion: "0.3.0" } : { ...base, state: "foreign" };
  }
  return { ...base, state: manifest.hash === installedHash ? "outdated" : "modified", installedVersion: manifest.version };
}

const SKIP_REASON: Partial<Record<SkillState, string>> = {
  modified: "edited locally since it was installed; --force replaces it",
  foreign: "a different skill with this name exists; --force replaces it",
  external: "managed by another installer (e.g. `npx skills`); update it there, or --force to replace"
};

function copySkill(skill: string, to: string) {
  const from = path.join(bundledSkillsDir(), skill);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  const manifest: SkillManifest = { package: "@codemeall/harness-bridge", version: PACKAGE_VERSION, hash: skillTreeHash(from) };
  fs.writeFileSync(path.join(to, SKILL_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * Install or update the bundled skills. Older copies this tool installed are
 * updated in place; anything edited locally, installed by another tool, or
 * belonging to another author is left alone unless `force` is set.
 */
export function installSkills(options: SkillInstallOptions = {}): SkillInstallResult {
  const targetDir = resolveSkillsTarget(options);
  const result: SkillInstallResult = { targetDir, installed: [], updated: [], skipped: [], removed: [], reasons: {} };
  fs.mkdirSync(targetDir, { recursive: true });
  for (const skill of BUNDLED_SKILLS) {
    const to = path.join(targetDir, skill);
    const status = skillStatus(targetDir, skill);
    if (status.state === "current") {
      if (!fs.lstatSync(to).isSymbolicLink() && !readManifest(to)) copySkill(skill, to);
      result.installed.push(skill);
    } else if (status.state === "missing") {
      copySkill(skill, to);
      result.installed.push(skill);
    } else if (status.state === "outdated" || options.force) {
      copySkill(skill, to);
      result.updated.push(skill);
    } else {
      result.skipped.push(skill);
      result.reasons[skill] = SKIP_REASON[status.state] ?? status.state;
    }
  }
  return result;
}

/** Remove the bundled skills. Only removes skills this tool (or an older version of it) installed, unless forced. */
export function uninstallSkills(options: SkillInstallOptions = {}): SkillInstallResult {
  const targetDir = resolveSkillsTarget(options);
  const result: SkillInstallResult = { targetDir, installed: [], updated: [], skipped: [], removed: [], reasons: {} };
  for (const skill of BUNDLED_SKILLS) {
    const dir = path.join(targetDir, skill);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(dir);
    } catch {
      continue;
    }
    const ours = !stat.isSymbolicLink() && (readManifest(dir) !== undefined || isHarnessBridgeSkill(dir, skill));
    if (!ours && !options.force) {
      result.skipped.push(skill);
      result.reasons[skill] = stat.isSymbolicLink() ? "managed by another installer (e.g. `npx skills remove`)" : "not a Harness Bridge skill";
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    result.removed.push(skill);
  }
  return result;
}
