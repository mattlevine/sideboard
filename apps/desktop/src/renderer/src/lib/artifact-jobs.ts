import type { MessagePart } from '@sideboard-ai/core';
import {
  asRecord,
  inferJobLogStatus,
  parseLogStatus,
  parseMaybeJson,
  str,
  unwrapToolResultPayload,
  type ArtifactLogStatus,
} from './artifact-record';
import type { ChatArtifact } from './artifacts';

function isJobWaitTool(shortName: string): boolean {
  return /^(wait_for_job|stop_job)$/i.test(shortName);
}

function isShellTool(shortName: string): boolean {
  return /^(bash|shell|zsh)$/i.test(shortName);
}

function jobIdFromCommand(blob: string): string | undefined {
  const fromArg =
    /detached-job\.(?:js|cjs)["']?\s+(?:start|wait|stop|status|ui)\s+([A-Za-z0-9._-]{1,64})/i.exec(
      blob,
    );
  const token = fromArg?.[1];
  // `wait --pid-file` / `ui --title` are flags, not kebab job ids.
  if (token && !token.startsWith('-')) return token;
  const fromPath = /detached-jobs[/\\]([A-Za-z0-9._-]{1,64})(?:[/\\]|$)/i.exec(blob);
  return fromPath?.[1];
}

function looksLikeJobPayload(rec: Record<string, unknown>): boolean {
  if (typeof rec.stillRunning === 'boolean' && (parseLogStatus(rec.status) || str(rec.id) || typeof rec.ok === 'boolean')) {
    return true;
  }
  if (typeof rec.delta === 'string' && (parseLogStatus(rec.status) || str(rec.id))) return true;
  if (rec.started === true || rec.reason === 'already-running') return true;
  if (typeof rec.stopped === 'boolean' && (str(rec.id) || parseLogStatus(rec.status))) {
    return true;
  }
  return false;
}

export function lastCompletedJobPayload(
  parts: MessagePart[] | undefined,
): Record<string, unknown> | undefined {
  if (!parts?.length) return undefined;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part || part.type !== 'tool') continue;
    if (part.status === 'running') continue;
    const payload = jobPayloadFromResult(part.result);
    if (payload) return payload;
  }
  return undefined;
}

function jobPayloadFromResult(result: unknown): Record<string, unknown> | undefined {
  const unwrapped = unwrapToolResultPayload(result);
  const rec = asRecord(unwrapped);
  if (rec && looksLikeJobPayload(rec)) return rec;
  const text =
    typeof unwrapped === 'string'
      ? unwrapped
      : (str(rec?.stdout) ?? str(rec?.output) ?? str(rec?.text));
  if (!text?.trim()) return undefined;
  const trimmed = text.trim();
  const parsed = asRecord(parseMaybeJson(trimmed));
  if (parsed && looksLikeJobPayload(parsed)) return parsed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = asRecord(parseMaybeJson(trimmed.slice(start, end + 1)));
    if (sliced && looksLikeJobPayload(sliced)) return sliced;
  }
  return undefined;
}

function jobLogArtifact(opts: {
  id: string;
  title: string;
  content: string;
  status: ArtifactLogStatus;
  phase?: string;
}): ChatArtifact {
  return {
    id: `tool-${opts.id}`,
    title: opts.title,
    kind: 'log',
    language: 'log',
    content: opts.content,
    source: 'tool',
    status: opts.status,
    phase: opts.phase,
    mode: 'append',
  };
}

/** wait_for_job / stop_job / shell detached-job JSON → append-only log pane. */
export function extractJobLogArtifact(
  shortName: string,
  part: Extract<MessagePart, { type: 'tool' }>,
  input: Record<string, unknown> | undefined,
  result: unknown,
): ChatArtifact | undefined {
  const blob = [
    part.detail,
    part.description,
    str(input?.command),
    str(input?.cmd),
    input ? JSON.stringify(input) : '',
  ]
    .filter(Boolean)
    .join(' ');
  const waitStop = isJobWaitTool(shortName);
  const fromShell = isShellTool(shortName) && /detached-job\.(?:js|cjs)\b/i.test(blob);
  if (!waitStop && !fromShell) return undefined;

  const payload = jobPayloadFromResult(result);
  const id =
    str(payload?.id) ??
    str(payload?.artifact_id) ??
    str(input?.id) ??
    jobIdFromCommand(blob);
  if (!id) return undefined;

  const stopCmd = /^stop_job$/i.test(shortName) || /\bstop\s+[A-Za-z0-9._-]{1,64}\b/i.test(blob);
  const startCmd = fromShell && /\bstart\b/i.test(blob);
  const status =
    inferJobLogStatus(payload) ??
    (stopCmd && (payload || part.status === 'done' || part.status === 'error')
      ? 'failed'
      : startCmd || part.status === 'running'
        ? 'running'
        : part.status === 'error'
          ? 'failed'
          : 'ok');
  const delta =
    typeof payload?.delta === 'string'
      ? payload.delta
      : typeof payload?.content === 'string'
        ? payload.content
        : '';
  const progress = str(payload?.progress);
  const content = delta || (progress && progress !== '(no log yet)' ? progress : '');

  return jobLogArtifact({
    id,
    title: str(payload?.title) ?? str(input?.title) ?? id,
    content,
    status,
    phase: str(payload?.phase),
  });
}
