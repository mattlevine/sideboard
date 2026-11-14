---
name: skill-improver
description: >-
  When a miss will recur — you made it twice, or a person told you the rule —
  write the lesson into the skill before the turn ends. One sentence, in the
  same change. Run in the turn, not on a schedule.
---

# Skill improver

You are the one who heard it. Write it down before this turn ends.

Nothing collects it afterwards. No Sideboard tool returns another chat's transcript, and you are told to stay inside your own checkout. The transcripts do exist on disk in Sideboard's app data, so a later pass that reads them could be built. This repo has not built one: it would mean agents reading other chats. You already have the correction and the context it came with, so the sentence lands now. The next agent remembers it by reading the skill.

## When

One bar: the miss will recur. That is true when either of these happened.

- You made the same miss twice.
- A person told you the rule, and their reason will still hold next time. This includes a pull-request review reply you are addressing.

Skip a one-off. Skip "fixed in abc123" and a bug in one file. Those are code fixes.

Verifiable fan-out (migration, port, batch fix) stays on `/graph-engineering`. That batch edits its own rulebook, because a command can say pass or fail. This skill is the sentence for judgment a script cannot score.

## Decide

Keep it when all of these hold:

- You know why. A thumb with no reason does not teach the next run.
- The skill does not already say it.
- You would still teach it after reading the code. Feedback is sometimes wrong.

Drop it when:

- A test or typecheck can encode it. Write that instead.
- It contradicts a principle already in the skill. Do not stack exceptions until the principle disappears.
- It is memory of one task ("the button is blue"). A skill is a procedure. It changes on purpose.

## Write

One sentence. The smallest one that captures the why. Write it the way you would tell a smart teammate, not as an exhaustive case list.

Look for the paragraph that already covers the area and tighten it. Add a new sentence only when nothing there can carry the point. A skill that grows by a paragraph per correction stops being read.

Put it in the skill that owns the process, in this same change. The default is [`.claude/skills/review/SKILL.md`](../review/SKILL.md) when the correction is about review. Use another skill when the correction is about that process (install, release, bugbot follow-ups, this one). A repo with no review skill keeps review notes in `.context/review.md`, which is local scratch.

Do not open a separate pull request for the sentence. It rides with the work.

Do not append a log of comments.
