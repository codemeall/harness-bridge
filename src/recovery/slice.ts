import { redactSecrets } from "../core/secrets.js";
import { resolveSession } from "../sessions/index.js";
import type { ProviderId, TranscriptEvent } from "../sessions/types.js";
import { describeEvent } from "./collect.js";

export interface SliceOptions {
  session: string;
  provider?: ProviderId;
  from?: number;
  to?: number;
  around?: number;
  radius?: number;
  grep?: string;
  maxMatches?: number;
  includeToolOutput?: boolean;
  maxChars?: number;
}

/**
 * Layer-3 drill-down: a bounded, redacted view of selected transcript lines.
 * Selection is by line range, by a window around one line, or by text search.
 */
export function readTranscriptSlice(options: SliceOptions): string {
  const resolved = resolveSession(options.session, options.provider);
  const maxChars = Math.min(Math.max(options.maxChars ?? 8000, 500), 40000);
  const radius = Math.min(Math.max(options.radius ?? 15, 1), 200);
  let from = options.from ?? 1;
  let to = options.to ?? Number.MAX_SAFE_INTEGER;
  if (options.around !== undefined) {
    from = Math.max(1, options.around - radius);
    to = options.around + radius;
  }
  const needle = options.grep?.toLowerCase();
  const maxMatches = Math.min(options.maxMatches ?? 20, 100);
  if (options.from === undefined && options.to === undefined && options.around === undefined && !needle) {
    throw new Error("Choose a range: from/to, around, or grep.");
  }

  const lines: string[] = [];
  let used = 0;
  let matches = 0;
  let truncated = false;
  const stats = resolved.adapter.read(resolved.path, (event: TranscriptEvent) => {
    if (truncated) return;
    if (event.line < from || event.line > to) return;
    if (needle) {
      const haystack = `${event.text ?? ""} ${event.command ?? ""} ${event.inputSummary ?? ""} ${event.tool ?? ""}`.toLowerCase();
      if (!haystack.includes(needle) || matches >= maxMatches) return;
      matches += 1;
    }
    const line = redactSecrets(describeEvent(event, options.includeToolOutput === true));
    if (used + line.length > maxChars) {
      truncated = true;
      return;
    }
    lines.push(line);
    used += line.length + 1;
  });

  const header = `${resolved.adapter.displayName} session ${resolved.id} · ${stats.lines} lines · showing ${needle ? `matches for "${options.grep}"` : `L${from}–L${Math.min(to, stats.lines)}`}`;
  const footer = truncated
    ? `… stopped at ${maxChars} characters; narrow the range or raise maxChars.`
    : needle && matches >= maxMatches
      ? `… first ${maxMatches} matches shown.`
      : lines.length === 0
        ? "No events in this selection."
        : "";
  return [header, ...lines, footer].filter(Boolean).join("\n");
}
