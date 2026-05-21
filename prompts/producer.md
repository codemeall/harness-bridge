# Producer prompt

Use this when you want to **deliberately finalize** the bridge before a handoff — for example, before closing a session, switching providers, or stepping away for the day.

Continuous checkpointing already keeps the bridge mostly current. The producer prompt is the touch-up pass: it confirms nothing in the conversation slipped past a checkpoint.

---

Finalize `.harness/bridge.md` for handoff.

1. **Read the current bridge.**

2. **Walk back through this session.** For every meaningful action since the last `last_updated`:
   - Confirm completed steps are checked off in *Plan*.
   - Move any decisions made verbally (in our chat) into *Decisions & rationale* — append, don't revise.
   - Add anything we deliberately deferred to *Open questions*.
   - Update *Files touched* to reflect current working state.

3. **Sharpen the Next action.** It must be:
   - Imperative ("Run X", "Edit Y", "Verify Z").
   - Specific — file paths, function names, commands.
   - Executable without re-reading the rest of the bridge.

4. **Update frontmatter:**
   - `last_updated`: now (ISO-8601 UTC).
   - `head`: `git rev-parse --short HEAD`.
   - `dirty`: true iff `git status --porcelain` has output.
   - `branch`: current branch.

5. **Show me the final bridge** before I commit. Highlight what changed since the last `last_updated`.

If anything in the current bridge contradicts what actually happened in this session, surface the discrepancy explicitly — do not silently overwrite.
