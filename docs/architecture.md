# Cross-provider session recovery — architecture

**Outcome:** when one coding agent becomes unavailable (usage limit, crash, auth expiry), you can recover that exact session from files already on disk and continue in another provider. The source provider is never contacted.

See [`audit.md`](./audit.md) for the state of the code before this work.

## 1. T3 Code comparison

T3 Code was inspected at commit `3a87681d` (2026-10-27), read-only. Paths below are under `apps/server/src/orchestration-v2/` unless stated otherwise. **V** = verified in source; **I** = inferred.

| Capability | T3 Code implementation | Harness Bridge before (0.2) | Harness Bridge now (0.3) |
|---|---|---|---|
| Shared conversation history | **V.** Its own event-sourced SQLite store (`~/.t3/userdata/statev2.sqlite`: `orchestration_v2_events`, `projection_messages`, `projection_provider_threads`, `projection_context_handoffs`, FTS search). | None. Only `.harness/bridge.md`. | Deliberately none. Native transcripts stay where they are; the bridge holds the distilled task state (design principle A). |
| Native provider sessions | **V.** Claude Agent SDK `query({sessionId/resume})`; `codex app-server` JSON-RPC (`thread/start`, `thread/resume`). The native id is stored in `nativeThreadRef`. | None. | Prints the verified native resume command (`claude --resume <id>`, `codex resume <id>`), kept separate from cross-provider continuation. |
| Cross-provider handoff | **V.** Allowed mid-thread for adapters with `supportsProviderSwitchingViaHandoff`. Creates a new native session and sends a **budgeted verbatim selection** of past messages (not an LLM summary, 16k cap), via Codex `thread/inject_items` or inline for Claude (`ContextHandoffService.ts`, `handoffBudget.ts`). | Manual: the producer prompt, then the consumer prompt. | Deterministic recovery package (budgeted verbatim prompts + derived task/file/command state), referenced by path in the destination's first prompt. |
| Emergency recovery after usage exhaustion | **V, same provider only.** Classifies `usage_limit` with `resetAt`; `UsageLimitRecoveryWorker` sends "Continue where you left off." after the reset. No automatic failover to another provider. | Recover prompt; the LLM reads raw JSONL. | Reads the transcript; detects `error:"rate_limit"` / usage-limit records; continuation in any installed provider. |
| Transcript discovery | **V.** `AgentSessionScanner.ts` scans `~/.claude/projects/*/*.jsonl` and `~/.codex/sessions/**/rollout-*.jsonl`, newest first with scan budgets, grouped by `cwd`; skips T3 worktrees. | Docs only; "most recent file" heuristic. | `session_list` / `harness-bridge sessions`. Reads only head and tail bytes; matches by recorded `cwd` (exact, subdir, git worktree, or "possible" for deleted worktrees). |
| Session selection | **V.** Importer tags candidates Importable / AlreadyImported / Duplicate; native id kept as a strong ref. | None. | Explicit id or path required. Interactive picker on a TTY; `--latest` limited to the same workspace; never cross-workspace without a warning. |
| Context compression | **V.** Relies on provider compaction (`/compact`, `thread/compact/start`); T3 itself does no summarizing. | None. | Reuses the provider's latest compaction summary from the transcript; never re-summarizes with an LLM. |
| Session library / history | **V.** Projects keyed by workspace root; threads with FTS; worktrees under `~/.t3/worktrees/<repo>/…`. | None. | No registry. Native stores are the index; saved packages in `.harness/recovery/` (frontmatter: provider, session, end state) form the recovery history. |
| Destination-provider launch | **V.** Programmatic (SDK / app-server). Never spawns an interactive CLI. | None. | Generates a verified launch command; `--launch` spawns it in a TTY. A stdio MCP server cannot attach a TUI, so over MCP the command is returned. |
| Recovery without source-provider execution | **V.** Handoff built from T3's own store. Imported threads get the last ~32k chars "as context, not instructions". | Partial (the agent reads files itself). | Yes. Pure local file parsing plus `git`. Tested with a fake `claude` binary that records any invocation (`tests/recovery.test.ts`, Scenario A). |

**Borrowed from T3:**
- Budgeted verbatim selection: first user message, latest user messages, last assistant messages.
- The "context, not instructions" framing.
- A paged read tool for omitted history (`session_read`, like `t3_thread_read`).
- `cwd`-based transcript matching with scan budgets, aware of deleted worktrees.

**Not borrowed:**
- T3's event store, live session pool and app-server injection. Harness Bridge owns no runtime, so it delivers context through files and prompt text.

**Gap T3 leaves open, filled here:** continuing in a *different* provider while the source is rate-limited.

## 2. Components

```
src/core/            bridge schema, git grounding, secrets (one table: refuse + redact)
src/sessions/        provider adapters → normalized TranscriptEvent stream
  claude.ts          ~/.claude/projects/<encoded cwd>/<uuid>.jsonl
  codex.ts           ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl ("items" + "legacy" layouts)
  index.ts           list / resolve (path allow-list) / follow continued-in chains
src/recovery/
  collect.ts         single-pass bounded reducer (rings, caps): goal, prompts, tasks, files, commands, errors, tail
  package.ts         repo verification, bridge comparison, budgeted markdown render, write to .harness/recovery/
  slice.ts           Layer-3 bounded, redacted line-range / grep reads
  destinations.ts    installed CLIs + verified launch argv
src/install.ts       skills → Claude Code / Codex / Antigravity skill dirs
src/mcp/server.ts    bridge_* (unchanged contracts) + session_list / session_recover / session_read / session_destinations
skills/              harness-bridge (everyday), recover-session (emergency, lazy-loaded)
```

### Adapter contract (`SessionAdapter`)

`roots()`, `list(workspace)`, `findById(id)`, `summarize(file)`, `read(file, onEvent)`, `nativeResumeCommand(id)`.

Only Claude Code and Codex implement it. They are the two providers whose on-disk format is verified on this machine and stable enough to parse.

### Progressive context loading

| Layer | What the destination agent loads | Typical size |
|---|---|---|
| 1 | `.harness/bridge.md` via `bridge_consume` (diffs capped at 2k per file / 6k total) | 1–3k chars |
| 2 | Recovery package (`session_recover`): budget 12k chars by default, rendered at three detail levels until it fits | ≤ 12k chars |
| 3 | `session_read` slices by line range, window or grep; capped at 8k chars by default | on demand |
| 4 | Destination prompt: ~450 chars, referencing the package **by path** | tiny |

Each layer only gets loaded when the one before it falls short. The transcript itself never enters the agent's context.

### What is deterministic vs LLM work

| Deterministic (code) | LLM (destination agent) |
|---|---|
| Find, filter and validate transcripts | Choose with the user which session to recover |
| Parse records; skip `api-request*`, attachments, meta, sidechains; dedupe re-sent prompts | Read the package; judge whether "done" claims hold in the code |
| Rebuild task state from TodoWrite / TaskCreate / TaskUpdate / update_plan | Restate goal / done / in progress / next; wait for confirmation |
| Map file writes to `git status` and commits since session start | Write the bridge (`bridge_recover` full, or `bridge_checkpoint` top-up) |
| Detect end state (usage limit, auth, abort, mid-tool-call) | Continue the implementation |
| Compare against the bridge: staleness, unlisted files, tasks done but unchecked | |
| Redact secrets; keep within the budget; write a git-ignored package | |

## 3. Workflow

```
harness-bridge sessions                         # 1-2  list sessions for this workspace (⚠ usage limit flags)
harness-bridge recover <id> --to codex          # 3-10 parse, verify vs git + bridge, write package, print command
codex -C <repo> '<short prompt → package path>' # 11   or --launch on a TTY
  destination agent: read package → spot-check → restate → WAIT   # 12
  user confirms → bridge_recover / bridge_checkpoint → continue    # 13
```

Over MCP, the same flow is `session_list` → `session_recover` (with `to`, plus `write` if the user wants it saved) → restate → confirm.

### Automatic vs user input

- **Automatic:** discovery, workspace matching, parsing, task reconstruction, repo verification, bridge staleness detection, redaction, building the package, generating destination and native-resume commands.
- **User decides:**
  - which session to recover (never inferred across workspaces, never "most recent" unless `--latest`);
  - whether to save the package (`--write` / `--to`);
  - which destination to use;
  - whether to launch it (`--launch`);
  - confirming the restated state before any edit;
  - any bridge write.

## 4. Native resume vs cross-provider continuation

| | Native resume | Cross-provider continuation |
|---|---|---|
| Command | `claude --resume <id>` · `codex resume <id>` · `agy --conversation <uuid>` | `codex -C <repo> '<prompt>'` · `claude '<prompt>'` · `agy -i '<prompt>'` · `cursor-agent '<prompt>'` |
| Keeps | Whatever the provider persists (full history, its compaction state) | Only what the package and bridge carry |
| Loses | Nothing extra | Hidden reasoning, tool state, exact wording of older turns (retrievable via `session_read`) |
| After a usage limit | Unavailable until the limit resets | Works immediately |

Recovery never requires native resume.

## 5. Antigravity and other providers

- **Antigravity CLI (`agy`)**
  - Supported as a **destination**: `agy -i "<prompt>"` run from the workspace, since `agy` has no cwd flag.
  - Native resume: `agy --conversation <uuid>`.
  - It loads `AGENTS.md`, so `bridge_init installInstructionsFor: "antigravity"` writes there. Skills install to `~/.gemini/antigravity-cli/skills/` or `.agents/skills/`.
  - **Not a recovery source yet.** Conversations are per-conversation SQLite files (`~/.gemini/antigravity-cli/conversations/<uuid>.db`) holding protobuf `step_payload` blobs. Google does not document that format. `conversation_summaries.db` (title, workspace, status) could support listing in a later version.
- **Gemini CLI**
  - Google moved individual users to Antigravity CLI on 2026-06-18 ([announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)), so it is no longer offered as a destination.
  - `GEMINI.md` installation remains for compatibility.
- **Cursor Agent**
  - Destination only (`cursor-agent "<prompt>"`).
  - Chat history isn't stored as readable files, so it can't be a recovery source.

## 6. Security and compliance

- Transcripts are read only from provider roots (`$CLAUDE_CONFIG_DIR|~/.claude/projects`, `$CODEX_HOME|~/.codex/{sessions,archived_sessions}`). The check uses realpath, so symlinks can't escape.
- Packages contain no raw tool output except the redacted 400-char tail of failed commands. They are written only on request, to `.harness/recovery/`, which carries its own `.gitignore` (`*`).
- `src/core/secrets.ts` covers:
  - key formats: Anthropic, OpenAI, GitHub, AWS, Slack, Stripe, Google, JWTs, PEM private keys;
  - Bearer headers, URL credentials, and generic `secret=`-style assignments.

  Matches are redacted in packages and slices, and refused in bridge writes.
- No git command that changes state is ever run.
- Launching a destination uses the user's own installed CLI and its existing login. Nothing bypasses authentication or quotas.
- Native resume after a usage limit is reported as unavailable, not worked around.
- Reading the local transcripts of tools the user runs is ordinary local file access. The formats are undocumented, though, and may change between provider versions. Adapters tolerate unknown records, but a format change can reduce what gets recovered.

## 7. Known limitations

- **Transcript formats are internal.** Verified against Claude Code 2.1.311 and Codex CLI 0.164 (Desktop "items" layout and the older layout).
- **Task status is a claim.** Code verifies files and commits; whether a "completed" task really works is left to the destination agent and the user. In the end-to-end test, Codex caught a "completed" exporter that was only a stub.
- **Shell-made edits** (`sed -i`, `mv`) aren't attributed to the session. They appear under "Uncommitted changes not written by the session's file tools".
- **Subagent (sidechain) transcripts are excluded.**
- **Deleted worktrees** (e.g. T3's `~/.t3/worktrees/...`) can only be matched as `possible`. File paths are mapped by relative layout.
- **No separate registry.** Listing scans provider directories each time: about 1 s for ~140 Claude project dirs, under 0.1 s for ~70 Codex rollouts on the test machine.
- **`--launch` needs a TTY.** MCP clients get the command to run.
- **What was verified live** (headless `codex exec`, read-only):
  - Codex consumed the package.
  - Codex discovered and recovered the Claude session itself.
- **Not exercised live:**
  - the post-confirmation bridge write;
  - the interactive picker and `--launch`;
  - launching Antigravity or Cursor (their commands come from each CLI's `--help`);
  - Codex as a recovery **source** (tested with fixtures only).
