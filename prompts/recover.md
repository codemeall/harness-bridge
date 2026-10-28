# Recover prompt

Use this when the bridge is **missing, stale or suspect**, or when a session died before handing off (usage limit, crash). Recovery rebuilds the state from the dead session's transcript on disk, so the source provider never needs to respond.

| Mode | When to use | Writes the bridge? |
|---|---|---|
| `full` | No usable `.harness/bridge.md` exists. | Yes, after you confirm |
| `since` | The bridge exists but is stale, e.g. the session died after the last checkpoint. | Yes, after you see the diff |
| `verify` | The bridge exists but you suspect it drifted. | No, report only |

---

Recover the Harness Bridge from the previous session's transcript. Mode: **<full | since | verify>**.

### Procedure

1. **Pick the session; don't guess.** List recent sessions for this workspace with `session_list` over MCP, or `harness-bridge sessions` on the CLI. Show me the candidates (provider, age, title, how each ended) and let me choose. Never fall back to "the most recently modified file".

2. **Build the evidence package** with `session_recover` (`session: <id>`), or `harness-bridge recover <id>`. The package is parsed deterministically: goal, task state, files checked against git, commands and their results, bridge staleness, and limitations. Statuses marked **(transcript)** are claims; **(repo)** means verified against the working tree.

3. **Need more detail?** Call `session_read`, or `harness-bridge transcript <id> --around <line>` / `--grep <text>`, using the line numbers in the package. Do not load the raw transcript.

4. **Execute the mode:**
   - **`full`:** draft a `harness-bridge/v1` bridge with `generated_by: recovery-from-transcript`. Pass it to `bridge_recover` with `write: false` to preview it, show it to me, and write only after I confirm.
   - **`since`:** use the package's *Bridge* section (events after `last_updated`, unlisted files, tasks done but not checked off). Show me the proposed changes, then apply them with `bridge_checkpoint`.
   - **`verify`:** report "Bridge says X; transcript/repo shows Y". Modify nothing.

5. **Never write silently**, and never copy secrets into the bridge.

### Without the tools (manual fallback)

If neither MCP nor the CLI is available:

1. Find the transcript.
   - Claude Code: `~/.claude/projects/<cwd with non-alphanumerics replaced by ->/<session>.jsonl`
   - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
2. Confirm the file with me.
3. Read it in chunks. Skip tool outputs and `api-request*` records. Redact secrets.
4. If it is larger than ~50K tokens, ask me to narrow the time range first.
