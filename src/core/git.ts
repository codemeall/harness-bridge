import { execFileSync } from "node:child_process";
import path from "node:path";
import type { GitState } from "./types.js";

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function getRepoRoot(cwd: string): string {
  try {
    return runGit(cwd, ["rev-parse", "--show-toplevel"]);
  } catch {
    return cwd;
  }
}

export function getGitState(cwd: string): GitState {
  const root = getRepoRoot(cwd);
  let branch = "unknown";
  let head = "unknown";
  let dirty = false;

  try {
    branch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    // Non-git directories can still hold a bridge during setup.
  }

  try {
    head = runGit(root, ["rev-parse", "--short", "HEAD"]);
  } catch {
    head = "unborn";
  }

  try {
    dirty = runGit(root, ["status", "--porcelain"]).length > 0;
  } catch {
    dirty = false;
  }

  return {
    repo: path.basename(root),
    branch,
    head,
    dirty,
    root
  };
}

export function gitDiffFromHead(cwd: string, head: string, file: string): string {
  const root = getRepoRoot(cwd);
  try {
    return runGit(root, ["diff", head, "--", file]);
  } catch {
    return "";
  }
}

export function gitStatusForFile(cwd: string, file: string): string {
  const root = getRepoRoot(cwd);
  try {
    return runGit(root, ["status", "--short", "--", file]);
  } catch {
    return "";
  }
}

export function gitLogRange(cwd: string, fromHead: string, toHead = "HEAD"): string {
  const root = getRepoRoot(cwd);
  try {
    return runGit(root, ["log", `${fromHead}..${toHead}`, "--oneline"]);
  } catch {
    return "";
  }
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
