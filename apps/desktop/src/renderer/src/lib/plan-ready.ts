import type { MessagePart, ThreadMessage } from '@sideboard-ai/core';
import {
  extractPresentedPlan,
  resolvePlanMarkdown,
  type PresentedPlan,
} from '@sideboard/plan-file';

/** Claude ExitPlanMode (or similar) — plan is ready for user approval. */
export function partsIncludeExitPlanMode(
  parts: MessagePart[] | undefined | null,
): boolean {
  if (!parts?.length) return false;
  return parts.some(
    (p) => p.type === 'tool' && /exitplanmode/i.test(p.name ?? ''),
  );
}

export function partsIncludePresentPlan(
  parts: MessagePart[] | undefined | null,
): boolean {
  return Boolean(extractPresentedPlan(parts));
}

/**
 * True when plan mode is on, the agent is idle, and the latest agent turn
 * signaled the plan is ready (present_plan / ExitPlanMode) or left a
 * substantial plan write-up.
 */
export function isPlanAwaitingApproval(opts: {
  planMode: boolean;
  status: string;
  messages: ThreadMessage[];
  liveParts?: MessagePart[];
  hasPendingQuestions?: boolean;
}): boolean {
  if (!opts.planMode) return false;
  if (opts.hasPendingQuestions) return false;
  if (opts.status === 'running' || opts.status === 'queued') return false;
  if (partsIncludePresentPlan(opts.liveParts)) return true;
  if (partsIncludeExitPlanMode(opts.liveParts)) return true;

  for (let i = opts.messages.length - 1; i >= 0; i--) {
    const m = opts.messages[i]!;
    if (m.role !== 'agent') continue;
    if (partsIncludePresentPlan(m.parts)) return true;
    if (partsIncludeExitPlanMode(m.parts)) return true;
    // Fallback: long agent reply after planning often is the plan itself.
    const text = (m.text ?? '').trim();
    if (text.length >= 400 && /(^|\n)#+\s|plan\b|implementation/i.test(text)) {
      return true;
    }
    return false;
  }
  return false;
}

/** Best-effort plan text to copy / hand off. */
export function latestPlanText(
  messages: ThreadMessage[],
  fileContent?: string | null,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'agent') continue;
    const fromTool = extractPresentedPlan(m.parts);
    if (fromTool?.content) return fromTool.content;
  }
  if (fileContent?.trim()) return fileContent.trim();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'agent' && m.text?.trim()) return m.text.trim();
  }
  return '';
}

export function latestPresentedPlan(
  messages: ThreadMessage[],
  fileContent?: string | null,
): PresentedPlan | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'agent') continue;
    const resolved = resolvePlanMarkdown({
      parts: m.parts,
      text: m.text,
      fileContent,
    });
    if (resolved) return resolved;
  }
  if (fileContent?.trim()) {
    return resolvePlanMarkdown({ fileContent });
  }
  return null;
}
