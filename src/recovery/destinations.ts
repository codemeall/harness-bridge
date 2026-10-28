import fs from "node:fs";
import path from "node:path";

export type DestinationId = "codex" | "claude-code" | "antigravity" | "cursor";

export interface Destination {
  id: DestinationId;
  name: string;
  binary: string;
  installed: boolean;
  binaryPath?: string;
  /** argv that opens the provider's interactive CLI in `cwd` with an initial prompt. */
  launch(prompt: string, cwd: string): string[];
  /** Whether the launch argv was checked against the CLI's own --help. */
  launchVerified: string;
}

// Flags verified against `--help` of codex-cli 0.164.0, Claude Code 2.1.311,
// Antigravity CLI `agy` 1.4.8 (-i/--prompt-interactive; no cwd flag) and cursor-agent (positional prompt).
// Gemini CLI is not offered: Google moved individual users to Antigravity CLI on 2026-06-18.
const DEFINITIONS: Omit<Destination, "installed" | "binaryPath">[] = [
  {
    id: "codex",
    name: "Codex",
    binary: "codex",
    launch: (prompt, cwd) => ["codex", "-C", cwd, prompt],
    launchVerified: "codex [-C DIR] [PROMPT] (codex-cli 0.164)"
  },
  {
    id: "claude-code",
    name: "Claude Code",
    binary: "claude",
    launch: (prompt) => ["claude", prompt],
    launchVerified: "claude [prompt], run from the workspace (Claude Code 2.1)"
  },
  {
    id: "antigravity",
    name: "Antigravity CLI",
    binary: "agy",
    launch: (prompt) => ["agy", "-i", prompt],
    launchVerified: "agy -i <prompt>, run from the workspace (agy 1.4.8)"
  },
  {
    id: "cursor",
    name: "Cursor Agent",
    binary: "cursor-agent",
    launch: (prompt) => ["cursor-agent", prompt],
    launchVerified: "cursor-agent [prompt...], run from the workspace"
  }
];

const ALIASES: Record<string, DestinationId> = {
  codex: "codex",
  claude: "claude-code",
  "claude-code": "claude-code",
  antigravity: "antigravity",
  agy: "antigravity",
  cursor: "cursor",
  "cursor-agent": "cursor"
};

export function parseDestination(value: string): DestinationId {
  const id = ALIASES[value.toLowerCase()];
  if (!id) throw new Error(`Unknown destination "${value}". Supported: ${DEFINITIONS.map((d) => d.id).join(", ")}.`);
  return id;
}

export function findOnPath(binary: string, envPath = process.env.PATH ?? ""): string | undefined {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}

export function detectDestinations(envPath?: string): Destination[] {
  return DEFINITIONS.map((definition) => {
    const binaryPath = findOnPath(definition.binary, envPath);
    return { ...definition, installed: Boolean(binaryPath), binaryPath };
  });
}

export function getDestination(id: DestinationId, envPath?: string): Destination {
  return detectDestinations(envPath).find((d) => d.id === id)!;
}

/** Quote argv for display in a POSIX shell. */
export function shellQuote(argv: string[]): string {
  return argv.map((arg) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(" ");
}
