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
