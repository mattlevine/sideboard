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

function isPinnedStderrLine(line: string): boolean {
  if (/^\s*at\s/.test(line)) return false;
  return /cannot find (?:package|module)|ERR_MODULE_NOT_FOUND|cursor startup failed:/i.test(
    line,
  );
}

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
  while (tail.length > maxLines) {
    const dropIdx = tail.findIndex((l) => !isPinnedStderrLine(l));
    if (dropIdx === -1) tail.shift();
    else tail.splice(dropIdx, 1);
  }
}

/** Cursor local-agent minified bundle dumped as a single stderr line on crash. */
function looksLikeMinifiedJsDump(line: string): boolean {
  if (line.length < 200) return false;
  return (
    /yield Promise\.all/.test(line) ||
    /\(0,[A-Za-z$]\.\w+\)/.test(line) ||
    /CURSOR_RIPGREP_PATH/.test(line) ||
    /findFilesWithRipgrep/.test(line) ||
    /@cursor\/sdk\/dist\//.test(line)
  );
}

function looksLikeNestedElectronCrash(line: string): boolean {
  return /HasCustomHostObject|ElectronInitializeICUandStartNode/i.test(line);
}

function looksLikeHomebrewLibuvCrash(line: string): boolean {
  const uvRun = /uv_run/i.test(line);
  const spin = /SpinEventLoopInternal/i.test(line);
  const homebrewUv = /Cellar\/libuv|libuv\.\d\.dylib/i.test(line);
  const homebrewNode = /Cellar\/node\//i.test(line);
  return (uvRun && (homebrewUv || spin || homebrewNode)) || (spin && (homebrewUv || homebrewNode));
}

const NESTED_ELECTRON_SUMMARY =
  'Cursor local agent crashed at Electron startup (nested Chromium / HasCustomHostObject)';

const HOMEBREW_LIBUV_SUMMARY =
  'Cursor runner crashed in Node (Homebrew Node + shared libuv). Install Node 22 LTS (`brew install node@22`) and retry.';

const MINIFIED_DUMP_SUMMARY =
  'Cursor local agent crashed during startup (truncated crash dump)';

function clipStderr(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars);
}

/** Join recent stderr lines into a single lastError-friendly string. */
export function summarizeTurnStderr(tail: string[], maxChars = 500): string {
  if (tail.length === 0) return '';
  const cursorStartup = [...tail]
    .reverse()
    .find((line) => /cursor startup failed:/i.test(line));
  if (cursorStartup) return clipStderr(cursorStartup, maxChars);
  // In-process checkpoint recovery logs "unresumable — starting a new session"
  // then the new run can still fail (Connection stalled). Prefer that failure.
  const cursorRunFailed = [...tail]
    .reverse()
    .find((line) => /^cursor run failed\b/i.test(line.trim()));
  if (cursorRunFailed) return clipStderr(cursorRunFailed, maxChars);
  if (tail.some(looksLikeNestedElectronCrash)) return NESTED_ELECTRON_SUMMARY;
  if (tail.some(looksLikeHomebrewLibuvCrash)) return HOMEBREW_LIBUV_SUMMARY;
  if (
    tail.some(
      (line) =>
        /\[resource_exhausted\]|resource_exhausted/i.test(line) ||
        /findFilesWithRipgrep/.test(line),
    )
  ) {
    return clipStderr(
      'Cursor local file search failed (ripgrep / resource_exhausted). Wait a minute and retry; if it keeps happening, check Cursor usage.',
      maxChars,
    );
  }
  // Prefer the actionable MODULE_NOT_FOUND line over the stack frames that follow.
  // Node ESM says "Cannot find package", CJS says "Cannot find module".
  const moduleMissing = [...tail]
    .reverse()
    .find((line) => /cannot find (?:package|module)/i.test(line));
  if (moduleMissing) return clipStderr(moduleMissing, maxChars);
  const useful = tail.filter((line) => !looksLikeMinifiedJsDump(line));
  if (useful.length === 0 && tail.some(looksLikeMinifiedJsDump)) {
    return MINIFIED_DUMP_SUMMARY;
  }
  // Prefer the last non-empty meaningful chunk; keep a bit of prior context.
  const joined = (useful.length ? useful : tail).slice(-6).join('\n').trim();
  return clipStderr(joined, maxChars);
}

/**
 * True when stderr/detail indicates the CLI could not resume its stored session.
 * Sideboard should clear `thread.sessionId` and retry with a seeded fresh session.
 */
export function looksLikeInvalidAgentSession(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  return (
    /session not found/.test(lower) ||
    /no conversation found/.test(lower) ||
    /conversation .+ not found/.test(lower) ||
    /thread .+ not found/.test(lower) ||
    /unknown session/.test(lower) ||
    /invalid session/.test(lower) ||
    /session .+ (missing|expired|deleted|gone)/.test(lower) ||
    /cannot resume/.test(lower) ||
    /failed to (load|resume|open) session/.test(lower) ||
    /corrupt local agent checkpoint/.test(lower) ||
    /missing root blob/.test(lower) ||
    /\bagent\b.{0,120}\bnot found\b/.test(lower)
  );
}

/**
 * Native Node/Cursor runner death (uv_run, nested Electron, truncated dump, or
 * empty stderr). Orchestrator respawns once. Not credits/auth/module-missing —
 * those will fail the same way.
 */
export function looksLikeRetryableRunnerCrash(text: string): boolean {
  if (looksLikeAgentFailureMessage(text)) return false;
  if (looksLikeInvalidAgentSession(text)) return false;
  const lower = text.trim().toLowerCase();
  if (/cannot find (?:package|module)|err_module_not_found/.test(lower)) return false;
  if (!lower) return true;
  return (
    /uv_run|spineventloopinternal|libuv|homebrew node \+ shared libuv|hascustomhostobject|electroninitializeicuandstartnode|nested chromium|truncated crash dump|connection stalled|sig(?:segv|abrt|ill)|segmentation fault|illegal instruction|fatal error/.test(
      lower,
    )
  );
}

/** Stale resume id, or a dead Node/Cursor runner with no assistant output. */
export function shouldRetryFailedAgentTurn(
  detail: string,
  opts: { hasSession: boolean },
): boolean {
  if (looksLikeInvalidAgentSession(detail) && opts.hasSession) return true;
  return looksLikeRetryableRunnerCrash(detail);
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
    /prompt is too long|context.*(too long|exceed)|conversation too long/.test(lower) ||
    /\[resource_exhausted\]|resource_exhausted/.test(lower) ||
    /findFilesWithRipgrep/.test(text)
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
  if (/\[resource_exhausted\]|resource_exhausted|findfileswithripgrep/.test(lower)) {
    return 'Cursor local file search failed (ripgrep / resource_exhausted). Wait a minute and retry; if it keeps happening, check Cursor usage.';
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
  if (/hascustomhostobject|electroninitializeicuandstartnode|nested chromium/i.test(lower)) {
    return `${raw} — retry the turn; if it keeps failing, pick another agent.`;
  }
  if (/homebrew node \+ shared libuv|uv_run|spineventloopinternal/i.test(lower)) {
    return /brew install node@22/i.test(raw)
      ? raw
      : `${raw} — install Node 22 LTS (\`brew install node@22\`) and retry.`;
  }
  if (/corrupt local agent checkpoint|missing root blob|truncated crash dump/.test(lower)) {
    return `${raw} — retry the turn (Sideboard will start a fresh Cursor session).`;
  }
  if (/connection stalled/.test(lower)) {
    return /retry the turn/i.test(raw)
      ? raw
      : `${raw} — retry the turn (Sideboard will start a fresh Cursor session).`;
  }
  return raw;
}

/**
 * Transcript text for a finished turn. Runner crashes and other failures with
 * no assistant output go in the agent bubble so wait_for_turn / get_turn_result
 * (and a later retry) can plan around them — not only the lastError footer.
 */
export function turnFailChatText(opts: {
  exitCode: number | null;
  assistantText: string;
  detail: string;
}): string {
  const chat = opts.assistantText.trim();
  if (chat) return chat;
  if (opts.exitCode === 0) return '';
  const detail = opts.detail.trim();
  if (detail) return humanizeAgentFailDetail(detail);
  return formatTurnExitError(opts.exitCode ?? 1, '');
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
