# Process skills

When the same shape of work will happen again, write a Claude Code project skill at `.claude/skills/<name>/SKILL.md` and commit it. Sideboard’s composer `/name` expander, Claude Code, and `attach` all load that path — so the guide works outside Sideboard. Do not put new skills in `.sideboard/skills` (Sideboard still scans it; other agents do not). Point Codex/OpenCode at the file from `AGENTS.md`. Optional: symlink `.cursor/skills/<name>` to the Claude skill.

- **One-offs** should not create a skill. The first run is still a loop; corrections become sentences in the guide.
- **Same miss twice** → edit the skill (or `.claude/skills/review/SKILL.md` when that review skill exists, else `.context/review.md`) and rerun. Do not patch three threads and leave the process unchanged.
- After merge to the default branch, **new worktrees inherit** the file. Existing siblings need an update from that branch.

`/long-running` is a **Sideboard product skill** — every worktree agent gets the detach-and-wait playbook (and the helper ships with the app). A committed `.claude/skills/long-running` in a repo still wins if you want to customize it.

Merge-readiness notes go in `.claude/skills/review/SKILL.md` when that skill already exists. Sideboard does not create a review skill.
