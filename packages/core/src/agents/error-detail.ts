/**
 * Turn opaque SDK / Node failure values into a short string for UI lastError.
 * Prefer message/code fields; never return the useless "[object Object]".
 */
export function formatUnknownDetail(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err.trim();
  if (err instanceof Error) {
    const base = err.message.trim() || err.name;
    const code =
      'code' in err && typeof (err as { code?: unknown }).code === 'string'
        ? (err as { code: string }).code.trim()
        : '';
    return code && !base.includes(code) ? `${base} (${code})` : base;
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const nested =
      o.error != null && typeof o.error === 'object'
        ? formatUnknownDetail(o.error)
        : '';
    const message =
      typeof o.message === 'string'
        ? o.message.trim()
        : typeof o.error === 'string'
          ? o.error.trim()
          : typeof o.result === 'string'
            ? o.result.trim()
            : nested;
    const code = typeof o.code === 'string' ? o.code.trim() : '';
    if (message) return code && !message.includes(code) ? `${message} (${code})` : message;
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}' && json !== 'null') return json;
    } catch {
      // fall through
    }
  }
  const fallback = String(err);
  return fallback === '[object Object]' ? '' : fallback;
}

/**
 * Best-effort message from agent NDJSON error payloads (Codex / OpenCode / Claude / …).
 */
export function extractJsonErrorMessage(obj: Record<string, unknown>): string | null {
  const nested =
    obj.error != null && typeof obj.error === 'object'
      ? (obj.error as Record<string, unknown>)
      : null;
  const candidates = [
    typeof obj.message === 'string' ? obj.message : null,
    typeof obj.error === 'string' ? obj.error : null,
    nested && typeof nested.message === 'string' ? nested.message : null,
    typeof obj.result === 'string' ? obj.result : null,
    typeof obj.detail === 'string' ? obj.detail : null,
  ];
  for (const c of candidates) {
    const t = c?.trim();
    if (t) return t;
  }
  if (Array.isArray(obj.errors)) {
    const parts = obj.errors
      .map((e) => formatUnknownDetail(e))
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  return null;
}

/** Node prints this as the last stderr line after a crash / uncaught exception. */
const NODE_VERSION_FOOTER = /^Node\.js v\d+/i;

/**
 * Keep a rolling stderr tail for turn failure detail, skipping Node's version footer
 * so lastError isn't just "Node.js v23.6.0".
 */
export function pushTurnStderr(tail: string[], line: string, maxLines = 12): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (NODE_VERSION_FOOTER.test(trimmed)) return;
  // Codex emits non-fatal reconnect notices as type=error — don't let them stick as lastError.
  if (/^reconnecting\.\.\./i.test(trimmed)) return;
  tail.push(trimmed);
  while (tail.length > maxLines) tail.shift();
}

/** Join recent stderr lines into a single lastError-friendly string. */
export function summarizeTurnStderr(tail: string[], maxChars = 500): string {
  if (tail.length === 0) return '';
  // Prefer the actionable MODULE_NOT_FOUND line over the stack frames that follow.
  const moduleMissing = [...tail]
    .reverse()
    .find((line) => /cannot find module/i.test(line));
  if (moduleMissing) {
    return moduleMissing.length <= maxChars
      ? moduleMissing
      : moduleMissing.slice(0, maxChars);
  }
  // Prefer the last non-empty meaningful chunk; keep a bit of prior context.
  const joined = tail.slice(-6).join('\n').trim();
  if (joined.length <= maxChars) return joined;
  return joined.slice(joined.length - maxChars);
}

/**
 * True when assistant/result text is itself the failure (Claude often prints
 * session limits as normal result text, then exits 1 with an empty stderr).
 */
export function looksLikeAgentFailureMessage(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  return (
    /you've hit your|hit your (session|weekly|opus) limit|usage limit/.test(lower) ||
    /credit balance is too low|out of credits|insufficient.?quota|quota.?exceeded/.test(lower) ||
    /invalid user api key|invalid api key|not logged in|not authenticated|unauthorized/.test(
      lower,
    ) ||
    /\b429\b|too many requests|rate.?limit/.test(lower) ||
    /prompt is too long|context.*(too long|exceed)|conversation too long/.test(lower)
  );
}

/**
 * When stderr is empty on a failed turn, recover a useful lastError from the
 * assistant text Claude/Codex already printed (limits, auth, …).
 */
export function fallbackTurnFailDetail(assistantText: string): string {
  const t = assistantText.trim();
  if (!t) return '';
  if (looksLikeAgentFailureMessage(t)) return t;
  // Short single-line system replies are better than a bare exit code.
  if (t.length <= 400 && !/\n\n/.test(t)) return t;
  return '';
}

/**
 * Light polish for common agent/CLI failures (credits, limits, auth).
 * Always keeps the original message; only adds a short hint when useful.
 */
export function humanizeAgentFailDetail(detail: string): string {
  const raw = detail.trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase();

  if (/credit balance is too low|out of credits|insufficient.?quota|quota.?exceeded|billing/.test(lower)) {
    return `${raw} — add credits or switch auth, then retry.`;
  }
  if (/hit your (session|weekly|opus) limit|usage limit|you've hit your/.test(lower)) {
    // Message already includes reset time ("· resets 7:10pm …") — keep it intact.
    return raw.includes('reset') ? raw : `${raw} — wait for the limit window to reset, then retry.`;
  }
  if (/\b429\b|rate.?limit|too many requests/.test(lower)) {
    return `${raw} — wait a moment and retry.`;
  }
  if (
    /invalid user api key|invalid api key|not logged in|not authenticated|unauthorized|authentication|please run.*login|codex login|claude auth|cursor api/.test(
      lower,
    )
  ) {
    return `${raw} — check agent login / API key in Settings.`;
  }
  if (/model .{0,80}(not found|unavailable|unknown|invalid)/.test(lower)) {
    return `${raw} — pick another model in the agent options.`;
  }
  if (/context.*(too long|exceed)|prompt is too long|conversation too long/.test(lower)) {
    return `${raw} — start a new chat or compact context, then retry.`;
  }
  return raw;
}

/** Build the thread lastError string for a non-zero agent exit. */
export function formatTurnExitError(
  exitCode: number | null,
  stderrSummary: string,
): string {
  const code = exitCode ?? 1;
  const raw = stderrSummary.trim();
  // Bare "exit 1" from a child process is useless — treat as empty.
  if (/^exit\s*\d+$/i.test(raw)) {
    return `exit ${code}: agent exited without details (credits, auth, rate limits, or a CLI error)`;
  }
  const detail = humanizeAgentFailDetail(raw);
  if (!detail) {
    return `exit ${code}: agent exited without details (credits, auth, rate limits, or a CLI error)`;
  }
  // Known user-facing failures already explain themselves — don't lead with "exit 1:".
  if (looksLikeAgentFailureMessage(raw)) return detail;
  return `exit ${code}: ${detail}`;
}
