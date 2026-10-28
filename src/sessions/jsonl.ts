import fs from "node:fs";

const CHUNK = 1024 * 1024;

export interface JsonlCallbackInfo {
  line: number;
}

/**
 * Stream a JSONL file with bounded memory. Malformed or truncated lines
 * (e.g. a transcript cut off mid-write) are counted and skipped.
 */
export function forEachJsonLine(
  file: string,
  onRecord: (record: Record<string, unknown>, info: JsonlCallbackInfo) => void,
  options: { maxLineBytes?: number } = {}
): { lines: number; malformed: number } {
  const maxLineBytes = options.maxLineBytes ?? 64 * 1024 * 1024;
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(CHUNK);
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let oversized = false;
  let lineNo = 0;
  let malformed = 0;

  const flush = (lineBuf: Buffer) => {
    lineNo += 1;
    if (oversized) {
      malformed += 1;
      oversized = false;
      return;
    }
    const text = lineBuf.toString("utf8").trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        onRecord(parsed as Record<string, unknown>, { line: lineNo });
      } else {
        malformed += 1;
      }
    } catch {
      malformed += 1;
    }
  };

  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, CHUNK, null);
      if (read === 0) break;
      let start = 0;
      for (let i = 0; i < read; i += 1) {
        if (buffer[i] !== 0x0a) continue;
        const piece = buffer.subarray(start, i);
        if (!oversized) pending.push(Buffer.from(piece));
        flush(Buffer.concat(pending));
        pending = [];
        pendingBytes = 0;
        start = i + 1;
      }
      if (start < read && !oversized) {
        pending.push(Buffer.from(buffer.subarray(start, read)));
        pendingBytes += read - start;
        if (pendingBytes > maxLineBytes) {
          oversized = true;
          pending = [];
          pendingBytes = 0;
        }
      }
    }
    if (pending.length > 0 || oversized) flush(Buffer.concat(pending));
  } finally {
    fs.closeSync(fd);
  }
  return { lines: lineNo, malformed };
}

/** Parse complete JSON lines from the first `maxBytes` of a file. */
export function readHeadRecords(file: string, maxBytes: number): Record<string, unknown>[] {
  return parseLines(readRange(file, 0, maxBytes), false, true);
}

/** Parse complete JSON lines from the last `maxBytes` of a file. */
export function readTailRecords(file: string, maxBytes: number): Record<string, unknown>[] {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - maxBytes);
  return parseLines(readRange(file, start, size - start), start > 0, false);
}

function readRange(file: string, start: number, length: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.max(0, Math.min(length, size - start));
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(text: string, dropFirst: boolean, dropLastIfPartial: boolean): Record<string, unknown>[] {
  const lines = text.split("\n");
  if (dropFirst) lines.shift();
  if (dropLastIfPartial && !text.endsWith("\n")) lines.pop();
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) out.push(parsed);
    } catch {
      // Partial or malformed line at a chunk boundary.
    }
  }
  return out;
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
