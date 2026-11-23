import { randomUUID } from 'node:crypto';

/** One chat can hold this many follow-ups at once. */
export const MAX_CHAT_FOLLOW_UPS = 10;

/** Pending CI follow-ups drop after a week when checks never finish. */
export const DEFAULT_FOLLOW_UP_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;

export type ChatFollowUpKind = 'ci' | 'at';

/** `pending` still running, `done` every check finished, `none` no PR or no rows. */
/** `unknown` is a failed checks read. It must not count as pending or finished. */
export type CiPhase = 'pending' | 'done' | 'none' | 'unknown';

export type ChatFollowUp = {
  id: string;
  kind: ChatFollowUpKind;
  prompt: string;
  /** When an `at` follow-up should send. */
  at?: string;
  /** Drop a still-pending `ci` follow-up after this without sending. */
  deadline: string;
  createdAt: string;
  /** CI state when this follow-up was registered. */
  ciBaseline?: CiPhase;
  /** True after a later poll saw checks still running. */
  ciSawPending?: boolean;
};

export function ciChecksSettled(
  checks: Array<{ bucket?: string }> | null | undefined,
): CiPhase {
  if (!checks) return 'none';
  if (checks.length === 0) return 'none';
  if (checks.some((check) => (check.bucket ?? 'pending') === 'pending')) return 'pending';
  return 'done';
}

/** `30m`, `2h`, `1d`, or an ISO timestamp. */
export function parseFollowUpAt(raw: string, now: Date): string | null {
  const text = raw.trim();
  const rel = /^(\d+)(m|h|d)$/i.exec(text);
  if (rel) {
    const n = Number(rel[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = rel[2]!.toLowerCase();
    const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() + n * ms).toISOString();
  }
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function normalizeChatFollowUps(raw: unknown): ChatFollowUp[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatFollowUp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.kind !== 'ci' && row.kind !== 'at') continue;
    if (typeof row.prompt !== 'string' || !row.prompt.trim()) continue;
    if (typeof row.deadline !== 'string' || !row.deadline.trim()) continue;
    if (typeof row.createdAt !== 'string' || !row.createdAt.trim()) continue;
    if (typeof row.id !== 'string' || !row.id.trim()) continue;
    const baseline = row.ciBaseline;
    const followUp: ChatFollowUp = {
      id: row.id.trim(),
      kind: row.kind,
      prompt: row.prompt.trim(),
      deadline: row.deadline.trim(),
      createdAt: row.createdAt.trim(),
    };
    if (typeof row.at === 'string' && row.at.trim()) followUp.at = row.at.trim();
    if (
      baseline === 'pending' ||
      baseline === 'done' ||
      baseline === 'none' ||
      baseline === 'unknown'
    ) {
      followUp.ciBaseline = baseline;
    }
    if (row.ciSawPending === true) followUp.ciSawPending = true;
    out.push(followUp);
    if (out.length >= MAX_CHAT_FOLLOW_UPS) break;
  }
  return out;
}

export function addChatFollowUp(
  existing: ChatFollowUp[],
  draft: {
    kind: ChatFollowUpKind;
    prompt: string;
    at?: string;
    deadline?: string;
    ciBaseline?: CiPhase;
  },
  now: Date,
): { ok: true; followUps: ChatFollowUp[] } | { ok: false; error: string } {
  if (existing.length >= MAX_CHAT_FOLLOW_UPS) {
    return { ok: false, error: 'This chat already has 10 follow-ups.' };
  }
  const prompt = draft.prompt.trim();
  if (!prompt) return { ok: false, error: 'prompt is required' };
  let at: string | undefined;
  let deadline: string;
  if (draft.kind === 'at') {
    if (!draft.at?.trim()) return { ok: false, error: 'at is required for a time follow-up' };
    const parsed = parseFollowUpAt(draft.at, now);
    if (!parsed) return { ok: false, error: 'at must be 30m, 2h, 1d, or an ISO time' };
    at = parsed;
    deadline = draft.deadline?.trim()
      ? parseFollowUpAt(draft.deadline, now) ?? ''
      : parsed;
    if (!deadline) return { ok: false, error: 'deadline must be 30m, 2h, 1d, or an ISO time' };
  } else {
    deadline = draft.deadline?.trim()
      ? parseFollowUpAt(draft.deadline, now) ?? ''
      : new Date(now.getTime() + DEFAULT_FOLLOW_UP_DEADLINE_MS).toISOString();
    if (!deadline) return { ok: false, error: 'deadline must be 30m, 2h, 1d, or an ISO time' };
  }
  const followUp: ChatFollowUp = {
    id: randomUUID(),
    kind: draft.kind,
    prompt,
    deadline,
    createdAt: now.toISOString(),
    ...(at ? { at } : {}),
    ...(draft.kind === 'ci' && draft.ciBaseline ? { ciBaseline: draft.ciBaseline } : {}),
  };
  return { ok: true, followUps: [...existing, followUp] };
}

export type FollowUpDecision = {
  fire: ChatFollowUp[];
  keep: ChatFollowUp[];
};

/**
 * `at` sends when its time arrives and joins a running turn.
 * `ci` sends when checks finish after this rule was created.
 * A CI rule that is still pending at its deadline is dropped and does not send.
 * `unknown` (a failed checks read) does not count as pending or finished.
 */
export function decideFollowUps(input: {
  followUps: ChatFollowUp[];
  now: Date;
  ci: CiPhase;
}): FollowUpDecision {
  const fire: ChatFollowUp[] = [];
  const keep: ChatFollowUp[] = [];
  const nowMs = input.now.getTime();
  for (const item of input.followUps) {
    if (item.kind === 'at') {
      const atMs = Date.parse(item.at ?? item.deadline);
      if (Number.isFinite(atMs) && nowMs >= atMs) fire.push(item);
      else keep.push(item);
      continue;
    }
    const sawPending =
      item.ciSawPending === true || input.ci === 'pending' || item.ciBaseline === 'pending';
    const next: ChatFollowUp = sawPending ? { ...item, ciSawPending: true } : item;
    const alreadyFinished =
      item.ciBaseline === 'done' && item.ciSawPending !== true && input.ci === 'done';
    const baselineCanFinish =
      item.ciBaseline === 'pending' || item.ciBaseline === 'none' || item.ciSawPending === true;
    const ready = input.ci === 'done' && !alreadyFinished && baselineCanFinish;
    if (ready) {
      fire.push(item);
      continue;
    }
    const deadlineMs = Date.parse(item.deadline);
    if (Number.isFinite(deadlineMs) && nowMs >= deadlineMs) continue;
    keep.push(next);
  }
  return { fire, keep };
}

/**
 * Apply a poll's decision onto the follow-ups saved while checks or send were
 * in flight. Fired ids drop. Deletes stay deleted. Adds made during the poll stay.
 */
export function mergeFollowUpPoll(input: {
  before: ChatFollowUp[];
  after: ChatFollowUp[];
  firedIds: string[];
  keep: ChatFollowUp[];
}): ChatFollowUp[] {
  const fired = new Set(input.firedIds);
  const keepById = new Map(input.keep.map((item) => [item.id, item]));
  const beforeIds = new Set(input.before.map((item) => item.id));
  return input.after.flatMap((item) => {
    if (fired.has(item.id)) return [];
    const fromPoll = keepById.get(item.id);
    if (beforeIds.has(item.id) && !fromPoll) return [];
    if (fromPoll?.ciSawPending && item.ciSawPending !== true) {
      return [{ ...item, ciSawPending: true }];
    }
    return [item];
  });
}
