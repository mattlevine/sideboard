import {
  looksLikeInvalidAgentSession,
  looksLikeRetryableRunnerCrash,
  looksLikeV8Oom,
} from './error-detail.js';

export type TurnFailureClass = 'auth' | 'quota' | 'refused' | 'timeout' | 'runner' | 'other';

/**
 * Class for a failed turn so a coordinator can branch without parsing lastError.
 * Null when there is no detail. Quota is checked before auth.
 */
export function classifyTurnFailure(detail: string | null | undefined): TurnFailureClass | null {
  const text = detail?.trim() ?? '';
  if (!text) return null;
  const lower = text.toLowerCase();
  if (
    /you've hit your|hit your (session|weekly|opus) limit|usage limit/.test(lower) ||
    /credit balance is too low|out of credits|insufficient.?quota|quota.?exceeded/.test(lower) ||
    /\b429\b|too many requests|rate.?limit/.test(lower) ||
    /\[resource_exhausted\]|resource_exhausted/.test(lower)
  ) {
    return 'quota';
  }
  if (
    /invalid user api key|invalid api key|not logged in|not authenticated|please run.*login|codex login|claude auth/.test(
      lower,
    )
  ) {
    return 'auth';
  }
  if (
    /prompt is too long|context.*(too long|exceed)|conversation too long/.test(lower) ||
    /model .{0,80}(not found|unavailable|unknown|invalid)/.test(lower) ||
    /\brefus(ed|al)\b|content policy/.test(lower)
  ) {
    return 'refused';
  }
  if (/connection stalled|\btimed out\b|inactivity timeout|\bETIMEDOUT\b/.test(lower)) return 'timeout';
  if (
    looksLikeRetryableRunnerCrash(text) ||
    looksLikeV8Oom(text) ||
    looksLikeInvalidAgentSession(text)
  ) {
    return 'runner';
  }
  return 'other';
}
