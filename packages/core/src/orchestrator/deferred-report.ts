/** Farewells are short. Long replies that quote the phrase are explanations. */
export const DEFERRED_DONE_MAX_CHARS = 480;

/** Last assistant text promised results later instead of waiting. */
export function looksLikeDeferredDonePromise(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > DEFERRED_DONE_MAX_CHARS) return false;
  const unquoted = t
    .replace(/`[^`]*`/g, ' ')
    .replace(/["“”][^"“”]*["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!unquoted) return false;
  return (
    /\b(i['’]?ll|i will)\s+let you know\b/i.test(unquoted) ||
    /\blet you know when\b/i.test(unquoted) ||
    /\b(check back|ping me)\s+when\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will)\s+(report|update you)\s+when\b/i.test(unquoted) ||
    /\bwill notify (?:me|you) when\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will) be notified when\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will)\s+(?:keep|continue)\s+(?:watching|waiting|polling|checking)\b/i.test(
      unquoted,
    ) ||
    /\bi(?:['’]ll| will)\s+come back (?:when|with|once|later)\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will)\s+get back\b/i.test(unquoted) ||
    /\bget back to (?:you|me)\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will)\s+(?:follow up|report back|circle back|check back)\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will)\s+reply (?:when|once|later|after|shortly)\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will)\s+ping you\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will)\s+ping when\b/i.test(unquoted) ||
    /\bi(?:['’]ll| will)\s+(?:message|dm|slack) you when\b/i.test(unquoted)
  );
}

/**
 * Orchestrator status updates are longer than a worktree farewell: a PR list,
 * then a closing line like "I'll ping when the approvals land." The short-message
 * check misses those. Look at the closing lines too.
 */
export function orchestratorPromisedLaterReport(text: string | null | undefined): boolean {
  if (looksLikeDeferredDonePromise(text)) return true;
  const t = (text ?? '').trim();
  if (!t || t.length <= DEFERRED_DONE_MAX_CHARS) return false;
  const lines = t.split('\n').map((line) => line.trim()).filter(Boolean);
  const closing: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (closing.length === 0 && line.length > DEFERRED_DONE_MAX_CHARS) {
      closing.push(line.slice(-DEFERRED_DONE_MAX_CHARS));
      break;
    }
    if (closing.length > 0 && size + line.length + 1 > DEFERRED_DONE_MAX_CHARS) break;
    closing.unshift(line);
    size += line.length + 1;
    if (closing.length >= 4) break;
  }
  const slice = closing.join('\n');
  if (!slice || slice === t) return false;
  return looksLikeDeferredDonePromise(slice);
}

/**
 * Orchestrator farewell. Child agents are the work, not a detached job in
 * the synthetic home. One nudge: wait out children that are still running,
 * or read idle children and reply now.
 */
export function formatOrchestratorDeferredContinuePrompt(): string {
  return [
    'You ended the turn after promising to report later.',
    'This chat does not resume on its own. Slack and the desktop only see a reply when you finish a turn with the outcome.',
    'list_chats for the child agents on this orchestration chat.',
    'If any child is still running (taskState submitted or working, stillRunning true), loop wait_for_turn until stillRunning is false, then read get_turn_result.',
    'If every child is already idle, read get_turn_result now. Idle means the work finished — do not treat that as “nothing is happening.”',
    'Then reply with what happened. Do not promise a later update.',
    'If you have not started the work yet, start it in this turn and wait until it finishes before you reply.',
  ].join(' ');
}
