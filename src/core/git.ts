import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GitState } from "./types.js";

/** Bridge state lives here; it must never make the working tree look dirty. */
const HARNESS_EXCLUDE = ":(exclude).harness";

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return runGit(cwd, args);
  } catch {
    return undefined;
  }
}

/** Resolve and validate a workspace directory. Throws instead of creating anything. */
export function resolveWorkspace(cwd: string): string {
  const resolved = path.resolve(cwd);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`Workspace path does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${resolved}`);
  }
  return resolved;
}

export function getRepoRoot(cwd: string): string {
  const workspace = resolveWorkspace(cwd);
  return tryGit(workspace, ["rev-parse", "--show-toplevel"]) ?? workspace;
}

export function isGitRepo(cwd: string): boolean {
  return tryGit(resolveWorkspace(cwd), ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/** Absolute path of the shared .git dir; identical for a repo and all its worktrees. */
export function gitCommonDir(cwd: string): string | undefined {
  let dir: string;
  try {
    dir = resolveWorkspace(cwd);
  } catch {
    return undefined;
  }
  const common = tryGit(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common ? fs.realpathSync(common) : undefined;
}

/** Porcelain status excluding `.harness/`. */
export function gitStatusPorcelain(cwd: string): string {
  return tryGit(getRepoRoot(cwd), ["status", "--porcelain", "--", ".", HARNESS_EXCLUDE]) ?? "";
}

export function getGitState(cwd: string): GitState {
  const root = getRepoRoot(cwd);
  const branch = tryGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "unknown";
  const head = tryGit(root, ["rev-parse", "--short", "HEAD"]) ?? "unborn";
  const dirty = gitStatusPorcelain(root).length > 0;
  return { repo: path.basename(root), branch, head, dirty, root };
}

export function gitDiffFromHead(cwd: string, head: string, file: string): string {
  return tryGit(getRepoRoot(cwd), ["diff", head, "--", file]) ?? "";
}

export function gitStatusForFile(cwd: string, file: string): string {
  return tryGit(getRepoRoot(cwd), ["status", "--short", "--", file]) ?? "";
}

export function gitLogRange(cwd: string, fromHead: string, toHead = "HEAD"): string {
  return tryGit(getRepoRoot(cwd), ["log", `${fromHead}..${toHead}`, "--oneline"]) ?? "";
}

/** One-line commits made at or after an ISO timestamp (newest first). */
export function gitLogSince(cwd: string, sinceIso: string, maxCount = 30): string[] {
  const out = tryGit(getRepoRoot(cwd), ["log", `--since=${sinceIso}`, `--max-count=${maxCount}`, "--format=%h %cI %s"]);
  return out ? out.split("\n").filter(Boolean) : [];
}

/** Files changed by commits since an ISO timestamp, relative to the repo root. */
export function gitFilesCommittedSince(cwd: string, sinceIso: string): Set<string> {
  const out = tryGit(getRepoRoot(cwd), ["log", `--since=${sinceIso}`, "--name-only", "--format="]);
  return new Set((out ?? "").split("\n").map((line) => line.trim()).filter(Boolean));
}

/** Map of repo-relative path → two-letter porcelain status (`.harness/` excluded). */
export function gitStatusMap(cwd: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of gitStatusPorcelain(cwd).split("\n")) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let file = line.slice(3);
    const arrow = file.indexOf(" -> ");
    if (arrow !== -1) file = file.slice(arrow + 4);
    map.set(file.replace(/^"|"$/g, ""), code);
  }
  return map;
}

export function gitDiffStat(cwd: string): string {
  return tryGit(getRepoRoot(cwd), ["diff", "HEAD", "--stat", "--", ".", HARNESS_EXCLUDE]) ?? "";
}

/** Absolute path of a file inside the git dir (handles worktrees), or undefined outside git. */
export function gitPath(cwd: string, name: string): string | undefined {
  const root = getRepoRoot(cwd);
  try {
    return path.resolve(root, runGit(root, ["rev-parse", "--git-path", name]));
  } catch {
    return undefined;
  }
}

export function isIgnoredByGit(cwd: string, file: string): boolean {
  const root = getRepoRoot(cwd);
  try {
    runGit(root, ["check-ignore", "-q", "--no-index", "--", file]);
    return true;
  } catch {
    return false;
  }
}
