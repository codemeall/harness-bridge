import fs from "node:fs";
import path from "node:path";
import { getRepoRoot, gitCommonDir } from "../core/git.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { byRecency, isTempPath, realpathOrSelf } from "./common.js";
import type { ProviderId, SessionAdapter, SessionSummary, WorkspaceInfo } from "./types.js";

export * from "./types.js";

export const ADAPTERS: Record<ProviderId, SessionAdapter> = {
  "claude-code": claudeAdapter,
  codex: codexAdapter
};

export const PROVIDER_IDS = Object.keys(ADAPTERS) as ProviderId[];

const PROVIDER_ALIASES: Record<string, ProviderId> = {
  claude: "claude-code",
  "claude-code": "claude-code",
  claudecode: "claude-code",
  codex: "codex",
  openai: "codex"
};

export function parseProvider(value: string | undefined): ProviderId | undefined {
  if (!value) return undefined;
  const provider = PROVIDER_ALIASES[value.toLowerCase()];
  if (!provider) throw new Error(`Unknown provider "${value}". Supported: ${PROVIDER_IDS.join(", ")}.`);
  return provider;
}

export function workspaceInfo(cwd: string): WorkspaceInfo {
  const root = realpathOrSelf(getRepoRoot(cwd));
  return { root, commonDir: gitCommonDir(root), name: path.basename(root) };
}

export interface ListOptions {
  provider?: ProviderId;
  limit?: number;
  /** Ignore the workspace filter (still hides temp/scratch dirs). */
  all?: boolean;
}

export function listSessions(cwd: string, options: ListOptions = {}): SessionSummary[] {
  const limit = options.limit ?? 10;
  const here = workspaceInfo(cwd);
  const workspace = options.all ? undefined : here;
  // Scratch sessions are noise, unless the user is working in a temp dir themselves.
  const hideTemp = !isTempPath(here.root);
  const providers = options.provider ? [options.provider] : PROVIDER_IDS;
  return providers
    .flatMap((provider) => ADAPTERS[provider].list(workspace, { limit, hideTemp }))
    .sort(byRecency)
    .slice(0, options.provider ? limit : limit * providers.length);
}

export interface ResolvedSession {
  adapter: SessionAdapter;
  path: string;
  id: string;
}

function isUnder(file: string, root: string): boolean {
  const realRoot = realpathOrSelf(root);
  return file === realRoot || file.startsWith(`${realRoot}${path.sep}`);
}

/**
 * Turn a session id or transcript path into a validated transcript file.
 * Paths must resolve (after symlinks) inside a provider's transcript root and end in `.jsonl`.
 */
export function resolveSession(session: string, provider?: ProviderId): ResolvedSession {
  const candidates = provider ? [ADAPTERS[provider]] : PROVIDER_IDS.map((id) => ADAPTERS[id]);
  const looksLikePath = session.includes("/") || session.includes("\\") || session.endsWith(".jsonl");

  if (looksLikePath) {
    const absolute = path.resolve(session.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
    if (!fs.existsSync(absolute)) throw new Error(`Transcript not found: ${absolute}`);
    const real = fs.realpathSync(absolute);
    if (!real.endsWith(".jsonl") || !fs.statSync(real).isFile()) throw new Error(`Not a .jsonl transcript file: ${real}`);
    const adapter = candidates.find((a) => a.roots().some((root) => isUnder(real, root)));
    if (!adapter) {
      const roots = candidates.flatMap((a) => a.roots()).join(", ");
      throw new Error(`Refusing to read ${real}: transcripts must live under a provider transcript directory (${roots}).`);
    }
    return { adapter, path: real, id: adapter.summarize(real, undefined).id };
  }

  if (!/^[A-Za-z0-9-]{8,}$/.test(session)) throw new Error(`Invalid session id: ${session}`);
  for (const adapter of candidates) {
    const file = adapter.findById(session);
    if (file) return { adapter, path: fs.realpathSync(file), id: session };
  }
  const where = provider ? ADAPTERS[provider].displayName : "Claude Code or Codex";
  throw new Error(`No ${where} transcript found for session ${session}. Run \`harness-bridge sessions\` to list available sessions.`);
}

/** Follow Claude `continued-in` links so recovery lands on the session where work actually continued. */
export function followContinuations(resolved: ResolvedSession, maxHops = 5): { resolved: ResolvedSession; chain: string[] } {
  const chain = [resolved.id];
  let current = resolved;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next = current.adapter.summarize(current.path, undefined).continuedIn;
    if (!next || chain.includes(next)) break;
    const file = current.adapter.findById(next);
    if (!file) break;
    current = { adapter: current.adapter, path: fs.realpathSync(file), id: next };
    chain.push(next);
  }
  return { resolved: current, chain };
}
