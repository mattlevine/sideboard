---
name: review
description: >-
  Merge-readiness review for this repository. Use when reviewing a PR, worktree
  diff, or Sideboard Review (Approve / Approve with nits / Request changes).
---

# Review guidelines:

You are reviewing a proposed code change so a human can decide whether it is **ready to merge / land**. Findings matter, but the primary deliverable is a clear readiness recommendation — not a laundry list of style notes.

## Required outcome

Start your reply with a **Recommendation** section using exactly one of:

- **Approve** — ready to merge as-is (or with only trivial nits the author can ignore).
- **Approve with nits** — ready to merge; list only optional polish that should not block.
- **Request changes** — not ready; blocking issues must be fixed first.
- **Needs more information** — cannot judge readiness yet (missing context, incomplete diff, unclear intent).

In 1–3 sentences, say **why** — grounded in correctness, risk, test coverage, and scope — not vibes. If you request changes, name the blockers explicitly.

People running this review are asking “can we ship this?” Treat that as the question you answer first.

## Findings

Below are guidelines for determining whether an issue is worth flagging to the original author.

These are not the final word. More specific guidelines elsewhere (developer message, user message, a file, etc.) override these.

Flag something as a bug / blocking finding only when:

1. It meaningfully impacts the accuracy, performance, security, or maintainability of the code.
2. The bug is discrete and actionable (not a vague codebase-wide complaint or a bundle of unrelated issues).
3. Fixing it does not demand rigor absent from the rest of the codebase.
4. The issue was introduced by this change (do not flag pre-existing bugs unless they are newly exposed by this PR).
5. The author would likely fix it if made aware.
6. It does not rely on unstated assumptions about the codebase or author intent.
7. Speculative breakage is not enough — identify the other code that is provably affected.
8. It is clearly not just an intentional change by the author.

When flagging an issue, include a short accompanying comment:

1. Clear about why it is a problem.
2. Severity must match reality — do not inflate.
3. Brief: at most one paragraph; avoid unnecessary line breaks in prose.
4. No code chunks longer than 3 lines; wrap code in inline ticks or a fenced block.
5. Call out scenarios / environments / inputs needed to hit the bug when severity depends on them.
6. Matter-of-fact tone — helpful assistant, not accusatory or effusive.
7. Skimmable on first read.
8. No empty flattery (“Great job…”, “Thanks for…”).

HOW MANY FINDINGS TO RETURN:

List every finding the author would fix if they knew about it. If nothing qualifies, say so and still give the Recommendation. Do not stop at the first finding.

GUIDELINES:

- Ignore trivial style unless it obscures meaning or violates documented standards.
- One comment per distinct issue (or a short multi-line range if needed).
- Use ```suggestion blocks ONLY for concrete replacement code (minimal lines; no commentary inside the block).
- In every ```suggestion block, preserve the exact leading whitespace of the replaced lines (spaces vs tabs, number of spaces).
- Do NOT introduce or remove outer indentation levels unless that is the actual fix.
- Separate **blocking** findings from **nits**. Only blocking findings should drive Request changes.

The report appears in chat (and can become Sideboard diff comments). Avoid unnecessary location chatter in the body; keep line ranges as short as possible (prefer ≤5–10 lines).

## Getting the diff

Use Sideboard's diff for this thread's worktree. Prefer the `get_diff` MCP tool (pass this thread's ref) for a compact summary, then read specific files with Read/Glob as needed. In the Sideboard desktop app, the Changes panel shows the same worktree diff.

If the user asks you to address or read line comments they added in the Changes / file diff UI, those arrive as `diff-comment` attachments on the next turn — follow them precisely.

## Fallback: if you don't have access to the Sideboard diff tool

If you don't have access to `get_diff`, use the following git commands to get the diff:

```bash
# Get the merge base between this branch and the target
MERGE_BASE=$(git merge-base origin/main HEAD)

# Get the committed diff against the merge base
git diff $MERGE_BASE HEAD

# Get any uncommitted changes (staged and unstaged)
git diff HEAD
```

Review the combination of both outputs: the first shows all committed changes on this branch relative to the target, and the second shows any uncommitted work in progress.

No need to mention in your report whether or not you used one of the fallback strategies; it's usually irrelevant.

## Output format

**1. Recommendation first** (required), then **2. Findings** (may be empty).

Only report ONE finding per unique issue.

<example>
## Recommendation

**Request changes** — The empty-input crash on load will break first-run users; fix that before merge. The unused helper is a nit and can wait.

## Findings

### **#1 Empty input causes crash** (blocking)

If the input field is empty when the page loads, the app will crash.

File: src/client/frontends/desktop/ui/Input.tsx

### **#2 Dead code** (nit)

The getUserData function is now unused. It should be deleted.

File: src/client/frontends/desktop/core/UserData.ts
</example>

<example>
## Recommendation

**Approve** — Diff is scoped, behavior looks correct, and there are no blocking issues. Safe to merge.
</example>

## Growing the rules

If a blocking issue is a missing or ambiguous repo rule that will recur, add one sentence to `.claude/skills/review/SKILL.md` (create the skill if it is missing — that is allowed and should be committed). Do not only patch this diff when the same miss will happen again. Do not write new skills under `.sideboard/skills/`. Do not use `.sideboard/review.md` for new notes.

Desktop renderer: `import type` from `@sideboard-ai/core` is fine; runtime value imports from that barrel pull Node deps (`execa`) into Vite and break `electron-vite build` / the right-sidebar Run script. Use a `@sideboard/…` alias to a Node-free core file (see `electron.vite.config.ts`; e.g. `@sideboard/home-board`, `@sideboard/issue-source-labels`) or a local renderer helper. Do not import `store/global-workspace.ts` or `board/load-home-board.ts` into the renderer — those pull Node.

Desktop pack: `stage-cursor-runtime.js` must resolve `@cursor/sdk` from `packages/core/package.json`. A Sideboard worktree does not hoist that package to the repo root — `createRequire(root package.json)` fails every `pnpm release` / `dist` there. Do not revert `fromFile` to the root package.

## Cost / usage fields

Before treating a provider USD field as additive per turn (message chips, thread Σ, MCP `usage`), confirm it is turn-scoped under Sideboard’s session model — Claude `total_cost_usd` is session-cumulative after `--resume`; prefer per-result `modelUsage.*.costUSD` (or a delta) when summing.
