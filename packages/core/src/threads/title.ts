/**
 * Legacy helpers kept for callers that still want a short label from free text
 * (e.g. orchestration goals). Workspace UI titles follow Conductor:
 * PR title → renamed branch → soccer-team nickname (see worktree-labels).
 */
export function titleFromPrompt(prompt: string, max = 60): string {
  let t = (prompt.trim().split(/\n/)[0] ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '';

  const sentence = t.match(/^(.+?[.!?])(\s|$)/);
  if (sentence?.[1] && sentence[1].length >= 12 && sentence[1].length <= max + 20) {
    t = sentence[1];
  }
  t = t.replace(/[.?!]+$/g, '').trim();

  const chatter =
    /^(hey[,!]?\s+|hi[,!]?\s+|hello[,!]?\s+|please\s+|can you\s+|could you\s+|would you\s+|i want (you )?to\s+|i need (you )?to\s+)/i;
  for (let i = 0; i < 4 && chatter.test(t); i++) {
    t = t.replace(chatter, '');
  }

  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);

  if (t.length <= max) return t;

  const sliced = t.slice(0, max - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const base = lastSpace > Math.floor(max * 0.4) ? sliced.slice(0, lastSpace) : sliced;
  return `${base.trimEnd()}…`;
}
