import type { ThreadAttachment } from '@sideboard-ai/core';

/** Worktree-relative path for the editable review prompt (Conductor-style). */
export const REVIEW_REQUEST_PATH = '.sideboard/attachments/Review request.md';

export const REVIEW_REQUEST_NAME = 'Review request.md';

export const REVIEW_REQUEST_PREFILL = `Please review the changes in this workspace and recommend whether they are ready to merge.

Start with a **Recommendation**: Approve, Approve with nits, Request changes, or Needs more information — and say why in 1–3 sentences. Then list blocking findings vs nits (findings may be empty).`;

/** Default guidelines — users can edit the on-disk file to taste. */
export const REVIEW_REQUEST_TEMPLATE = `# Review guidelines:

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
- Use \`\`\`suggestion blocks ONLY for concrete replacement code (minimal lines; no commentary inside the block).
- In every \`\`\`suggestion block, preserve the exact leading whitespace of the replaced lines (spaces vs tabs, number of spaces).
- Do NOT introduce or remove outer indentation levels unless that is the actual fix.
- Separate **blocking** findings from **nits**. Only blocking findings should drive Request changes.

The report appears in chat (and can become Sideboard diff comments). Avoid unnecessary location chatter in the body; keep line ranges as short as possible (prefer ≤5–10 lines).

## Getting the diff

Use Sideboard's diff for this thread's worktree. Prefer the \`get_diff\` MCP tool (pass this thread's ref) for a compact summary, then read specific files with Read/Glob as needed. In the Sideboard desktop app, the Changes panel shows the same worktree diff.

If the user asks you to address or read line comments they added in the Changes / file diff UI, those arrive as \`diff-comment\` attachments on the next turn — follow them precisely.

## Fallback: if you don't have access to the Sideboard diff tool

If you don't have access to \`get_diff\`, use the following git commands to get the diff:

\`\`\`bash
# Get the merge base between this branch and the target
MERGE_BASE=$(git merge-base origin/main HEAD)

# Get the committed diff against the merge base
git diff $MERGE_BASE HEAD

# Get any uncommitted changes (staged and unstaged)
git diff HEAD
\`\`\`

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
`;

const ATTACHMENTS_GITIGNORE = `# Sideboard review / composer attachments (local only)
*
!.gitignore
`;

/** Stock template from before readiness recommendations were required. */
const LEGACY_REVIEW_TEMPLATE_MARKERS = [
  'You are acting as a reviewer for a proposed code change made by another engineer.',
  'HOW MANY FINDINGS TO RETURN:',
];

/**
 * Refresh on-disk Review request.md when it still looks like the old findings-only
 * stock template (no readiness recommendation). Preserve real user customizations.
 */
export function shouldRefreshReviewRequestTemplate(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (/##\s*Recommendation|ready to merge|Approve with nits|Request changes/i.test(trimmed)) {
    return false;
  }
  return LEGACY_REVIEW_TEMPLATE_MARKERS.every((m) => trimmed.includes(m));
}

export function buildReviewRequestAttachment(content: string): ThreadAttachment {
  return {
    id: crypto.randomUUID(),
    name: REVIEW_REQUEST_NAME,
    kind: 'file',
    path: REVIEW_REQUEST_PATH,
    content,
  };
}

/**
 * Read an existing custom Review request.md if present. Does not create the file.
 */
export async function readExistingReviewRequestFile(
  threadId: string,
): Promise<string | null> {
  try {
    const existing = await window.sideboard.readFile(threadId, REVIEW_REQUEST_PATH);
    if (!existing.binary && existing.content.trim()) {
      return existing.content;
    }
  } catch {
    // absent
  }
  return null;
}

/**
 * Create (or refresh legacy) editable review guidelines and return contents.
 * Opt-in only — Review does not call this automatically.
 */
export async function ensureReviewRequestFile(threadId: string): Promise<string> {
  const gitignorePath = '.sideboard/attachments/.gitignore';
  try {
    await window.sideboard.readFile(threadId, gitignorePath);
  } catch {
    await window.sideboard.writeFile(threadId, gitignorePath, ATTACHMENTS_GITIGNORE);
  }

  try {
    const existing = await window.sideboard.readFile(threadId, REVIEW_REQUEST_PATH);
    if (!existing.binary && existing.content.trim()) {
      if (!shouldRefreshReviewRequestTemplate(existing.content)) {
        return existing.content;
      }
    }
  } catch {
    // create below
  }

  await window.sideboard.writeFile(threadId, REVIEW_REQUEST_PATH, REVIEW_REQUEST_TEMPLATE);
  return REVIEW_REQUEST_TEMPLATE;
}
