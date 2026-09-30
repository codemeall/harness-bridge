import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Skills shipped in the package's `skills/` directory. */
export const BUNDLED_SKILLS = ["harness-bridge", "handoff", "pickup"] as const;

export type SkillAgent = "claude-code" | "codex" | "cursor" | "gemini-cli";
export type SkillScope = "global" | "project";

// Mirrors the install locations used by the `skills` CLI (https://github.com/vercel-labs/skills),
// so both install paths put the skills in the same place.
const AGENT_SKILL_DIRS: Record<SkillAgent, { global: string; project: string }> = {
  "claude-code": { global: ".claude/skills", project: ".claude/skills" },
  codex: { global: ".codex/skills", project: ".agents/skills" },
  cursor: { global: ".cursor/skills", project: ".agents/skills" },
  "gemini-cli": { global: ".gemini/skills", project: ".agents/skills" }
};

export const SKILL_AGENTS = Object.keys(AGENT_SKILL_DIRS) as SkillAgent[];

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
  installed: string[];
  skipped: string[];
  removed: string[];
}

export function bundledSkillsDir(): string {
  return fileURLToPath(new URL("../../skills/", import.meta.url));
}

export function resolveSkillsTarget(options: SkillInstallOptions): string {
  const cwd = options.cwd ?? process.cwd();
  if (options.dir) {
    return path.resolve(cwd, options.dir);
  }
  const agent = options.agent ?? "claude-code";
  const dirs = AGENT_SKILL_DIRS[agent];
  if (!dirs) {
    throw new Error(`Unknown agent "${agent}". Use one of: ${SKILL_AGENTS.join(", ")}, or pass --dir.`);
  }
  return (options.scope ?? "global") === "global"
    ? path.join(options.homeDir ?? os.homedir(), dirs.global)
    : path.join(cwd, dirs.project);
}

function sameTree(a: string, b: string): boolean {
  const aEntries = fs.readdirSync(a).sort();
  const bEntries = fs.readdirSync(b).sort();
  if (aEntries.join("\n") !== bEntries.join("\n")) return false;
  return aEntries.every((entry) => {
    const aPath = path.join(a, entry);
    const bPath = path.join(b, entry);
    const aStat = fs.statSync(aPath);
    const bStat = fs.statSync(bPath);
    if (aStat.isDirectory() !== bStat.isDirectory()) return false;
    return aStat.isDirectory() ? sameTree(aPath, bPath) : fs.readFileSync(aPath).equals(fs.readFileSync(bPath));
  });
}

function isHarnessBridgeSkill(dir: string, name: string): boolean {
  const skillFile = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillFile)) return false;
  const content = fs.readFileSync(skillFile, "utf8");
  return new RegExp(`^name:\\s*${name}\\s*$`, "m").test(content) && /Harness Bridge/.test(content);
}

/**
 * Copy the bundled skills into an agent's skills directory. An existing skill
 * directory with different content is left alone unless `force` is set, so a
 * user's edits (or another author's skill with the same name) are never
 * overwritten silently.
 */
export function installSkills(options: SkillInstallOptions = {}): SkillInstallResult {
  const source = bundledSkillsDir();
  const targetDir = resolveSkillsTarget(options);
  const result: SkillInstallResult = { targetDir, installed: [], skipped: [], removed: [] };
  fs.mkdirSync(targetDir, { recursive: true });

  for (const skill of BUNDLED_SKILLS) {
    const from = path.join(source, skill);
    const to = path.join(targetDir, skill);
    if (fs.existsSync(to)) {
      if (sameTree(from, to)) {
        result.installed.push(skill);
        continue;
      }
      if (!options.force) {
        result.skipped.push(skill);
        continue;
      }
      fs.rmSync(to, { recursive: true, force: true });
    }
    fs.cpSync(from, to, { recursive: true });
    result.installed.push(skill);
  }
  return result;
}

/** Remove the bundled skills from an agent's skills directory. Only removes directories that are Harness Bridge skills. */
export function uninstallSkills(options: SkillInstallOptions = {}): SkillInstallResult {
  const targetDir = resolveSkillsTarget(options);
  const result: SkillInstallResult = { targetDir, installed: [], skipped: [], removed: [] };
  for (const skill of BUNDLED_SKILLS) {
    const dir = path.join(targetDir, skill);
    if (!fs.existsSync(dir)) continue;
    if (!options.force && !isHarnessBridgeSkill(dir, skill)) {
      result.skipped.push(skill);
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    result.removed.push(skill);
  }
  return result;
}
