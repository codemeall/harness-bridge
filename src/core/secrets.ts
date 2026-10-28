/**
 * One table of credential patterns, used both to refuse bridge writes and to
 * redact recovery output. Keep additions here so the two paths never drift.
 */

export interface SecretMatch {
  kind: string;
  index: number;
}

interface TokenPattern {
  kind: string;
  pattern: RegExp;
}

// Credentials with a recognizable shape. Always redacted, always refused.
const TOKEN_PATTERNS: TokenPattern[] = [
  { kind: "private key", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { kind: "API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "API key", pattern: /\bsk-(?:proj-|svcacct-|admin-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g },
  { kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { kind: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: "Stripe key", pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}/g }
];

// Credentials identified by context; only the captured value is replaced.
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/g;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi;
const ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|credential)s?[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"'`,;)]+)/gi;
const PLACEHOLDER =
  /^(?:<.*>|\$\{?[A-Za-z0-9_]+\}?|\[REDACTED.*|\*+|x{3,}|your[-_].*|changeme|example.*|null|none|undefined|true|false|process\.env\..*|env\..*)$/i;

function looksLikeSecretValue(value: string): boolean {
  if (value.length < 8) return false;
  if (/^\d+$/.test(value)) return false;
  if (PLACEHOLDER.test(value)) return false;
  return true;
}

export function findSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const { kind, pattern } of TOKEN_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      matches.push({ kind, index: match.index ?? 0 });
    }
  }
  for (const match of text.matchAll(BEARER)) matches.push({ kind: "bearer token", index: match.index ?? 0 });
  for (const match of text.matchAll(URL_CREDENTIALS)) matches.push({ kind: "URL credentials", index: match.index ?? 0 });
  for (const match of text.matchAll(ASSIGNMENT)) {
    if (looksLikeSecretValue(match[3])) matches.push({ kind: "credential assignment", index: match.index ?? 0 });
  }
  return matches.sort((a, b) => a.index - b.index);
}

/** Distinct labels (e.g. "GitHub token") of credential-shaped content in `text`. */
export function secretLabels(text: string): string[] {
  return [...new Set(findSecrets(text).map((match) => match.kind))];
}

export function containsSecrets(text: string): boolean {
  return findSecrets(text).length > 0;
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const { kind, pattern } of TOKEN_PATTERNS) {
    out = out.replace(pattern, `[REDACTED:${kind.toLowerCase().replace(/\s+/g, "-")}]`);
  }
  out = out.replace(BEARER, "$1[REDACTED]");
  out = out.replace(URL_CREDENTIALS, "$1[REDACTED]$3");
  out = out.replace(ASSIGNMENT, (whole, key: string, sep: string, value: string) =>
    looksLikeSecretValue(value) ? `${key}${sep}[REDACTED]` : whole
  );
  return out;
}
