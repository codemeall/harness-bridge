# Recover prompt

Use this when the bridge is **missing, stale, or suspect**. Recovery reads the producing session's transcript and either rebuilds the bridge from scratch, tops it up, or audits it.

There are three modes:

| Mode | When to use | Writes the bridge? |
|---|---|---|
| `full` | No usable `.harness/bridge.md` exists. | Yes (after you confirm) |
| `since` | Bridge exists but is stale (e.g. the last checkpoint missed the final 10 minutes before the session died). | Yes (you see the diff first) |
| `verify` | Bridge exists but you suspect it drifted from what actually happened. | No — report only |

`since` is the everyday mode. `full` is disaster recovery. `verify` is for trust checks.

---

Recover a Harness Bridge from this session's transcript. Mode: **<full | since | verify>**.

### Procedure

1. **Locate the transcript** for the producing session.
   - Refer to `providers/<provider>.md` in the Harness Bridge repo for the default transcript path on this provider.
   - If you can't find it, ask me for the file path.
   - If the transcript spans multiple files, take the most recently modified one for the current project.

2. **Read the transcript in chunks** to avoid loading the whole file at once. Skip large repeated tool outputs (file reads, command stdouts, build logs) — focus on user turns, assistant decisions, and tool calls that changed state.

3. **Redact secrets as you go.** API keys, tokens, passwords, `.env*` values, anything credential-shaped — never copy these into the bridge.

4. **Execute the chosen mode:**

   - **`full`** — Synthesize a fresh `.harness/bridge.md` per the `harness-bridge/v1` schema. Set `generated_by: recovery-from-transcript`. Populate every required field. Show me the proposed bridge before writing.

   - **`since`** — Read the existing bridge's `last_updated`. Find all transcript events after that timestamp. Append/update the affected sections (Plan checkboxes, Decisions, Open questions, Files touched, Next action). Bump `last_updated`. Show me a clear diff before writing.

   - **`verify`** — Compare bridge against transcript. Produce a report: "Bridge says X; transcript shows Y." Do **not** modify the file. Do **not** prompt me to update — just surface the discrepancies.

5. **Confirm before writing** (full / since modes). Never write the bridge silently.

### Token discipline

- Don't quote large transcript blocks back to me; summarize.
- If the transcript is larger than ~50K tokens, stop and ask whether to scope by time range first (e.g. "last 2 hours only").
- `since` mode should be cheap — it only needs the tail of the transcript.

### Privacy

Transcripts contain everything the session did — including potentially sensitive output. By running this prompt, I am opting in to having you read the transcript. Apply the secret-redaction rule strictly when producing the recovered bridge.
