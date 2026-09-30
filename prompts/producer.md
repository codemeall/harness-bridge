# Producer prompt

Use this when you want to **deliberately finalize** the bridge before a handoff — for example, before closing a session, switching providers, or stepping away for the day.

Continuous checkpointing already keeps the bridge mostly current. The producer prompt is the touch-up pass: it confirms nothing in the conversation slipped past a checkpoint.

---

Finalize `.harness/bridge.md` for handoff. Next session focus (optional): **<what the next session will be used for>**

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

   If I gave a next-session focus, write it to a `## Next session focus` section after *Goal*, make the Next action the first step toward it, and drop detail that doesn't serve it.

4. **Reference, don't duplicate.** Anything already captured in a spec, plan, ADR, issue, PR, commit, or doc goes in a `## References` section (after *Files touched*) as a path or URL — not copied into the bridge.

5. **Suggest skills.** Add a `## Suggested skills` section (after *References*) naming the skills the next agent should load for the Next action, one reason each. Only skills that exist in this environment; omit the section if none.

6. **Redact** secrets and personal data (keys, tokens, passwords, credentialed URLs, emails, customer data).

7. **Update frontmatter:**
   - `last_updated`: now (ISO-8601 UTC).
   - `head`: `git rev-parse --short HEAD`.
   - `dirty`: true iff `git status --porcelain` has output.
   - `branch`: current branch.

8. **Show me the final bridge** before I commit. Highlight what changed since the last `last_updated`, and tell me how to resume (paste `prompts/consumer.md`, or run `/pickup` where the skills are installed).

If anything in the current bridge contradicts what actually happened in this session, surface the discrepancy explicitly — do not silently overwrite.
