---
name: graph-engineering
description: Use when the same shape of work will repeat (migration, port, batch fix, fan-out across files or threads). Judge first, keep state on disk, grow a rulebook, blind-review, and fix the process—not each instance. Skip for one-off exploration.
---

# Graph engineering

You do not fix the code. You fix the process that produced the code.

A **loop** (model decides the next step) is correct for one-off and unfamiliar work. A **graph** (named steps, disk state, a mechanical exit) is for work that repeats and a machine can tell right from wrong.

## When to use this

Use it when you will do the same shape of work more than once and can write a command that returns 0/1.

Skip it when the task runs once, you do not know the steps yet, or only human taste can judge each item.

Middle path: run a loop first, write down every correction, then use those notes as the first rulebook for the second run.

## Method

1. **Judge first.** Before generating at scale, decide the command that means “this item passed” without opening the output (`test`, typecheck, schema check, or a yes/no model call). A thread going idle is a mood, not a judge. Break the judge on purpose once so a green result means something.

2. **Write the rulebook.** Capture ambiguities in a file workers read: this skill, a sibling `.claude/skills/<name>/SKILL.md`, `AGENTS.md`, or `.sideboard/review.md`. Every “in that case it should…” is a sentence. Nothing bypasses it — if you hand-edit output to match what the rulebook should have said, you have two sources of truth.

3. **Pilot three, then delete.** Run three items two ways, diff them, fix the **rules**, throw away the pilot output so you do not keep two conventions.

4. **State on disk.** Pending vs done is a file, a worktree, or a thread record — not chat memory. Kill at 60% and the next run rebuilds the queue from disk.

5. **Blind review.** Reviewers (Sideboard `request_review`, or a fresh session) see the output and the rulebook, not the worker’s reasoning. Prefer two isolated reviewers. Every finding cites a rule. Disagreement usually means the rulebook is ambiguous — edit it, do not coin-flip.

6. **Checks by cost.** Anything a script can verify, a model must not. Fast checks (seconds) sit inside the loop. Slow checks (full CI, long compile) run once in a batch. Serialize the expensive operation (one build owner, many patchers).

7. **Categories, not instances.** The same miss in the third file is one bad rule. Edit the skill / `review.md` / `AGENTS.md` and rerun the batch. Do not patch three files and leave the process unchanged.

8. **Model by role.** Stronger model for reviewers and anything that writes rules other agents will follow. Workers can stay on the default.

## Where new guides go

This skill is the **method**. Each recurring process gets its own skill:

- Write `.claude/skills/<kebab-name>/SKILL.md` and commit it. Sideboard `/name`, Claude Code, and `attach` load that path. Native agents do **not** scan `.sideboard/skills` — do not put new guides only there.
- Point Codex / OpenCode at the file from `AGENTS.md`.
- Optional: symlink `.cursor/skills/<name>` to the Claude skill.
- Skip a skill for a one-off.

After merge to the default branch, new worktrees inherit the file. Existing siblings need an update from that branch.

## Sideboard mapping

| Graph idea | Here |
|---|---|
| Worker node | Worktree thread |
| Judge | Tests / typecheck / `getPrChecks` — not “the agent said done” |
| Rulebook | This skill, sibling skills, `AGENTS.md`, `.sideboard/review.md` |
| Blind reviewer | `request_review` (fresh tab, no worker chat) |
| Disk queue | Worktrees + thread store; pending = no output / no passing judge |
| Human gate | `confirm_land` / purge |

Do not lock Global / orchestration chat into a fixed topology. Exploratory fleet work stays a loop. Use this skill when you fan out the same shape across many items or threads.
