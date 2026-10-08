import { useEffect, useState } from 'react';
import { joinLogChunks, type ChatArtifact } from './artifacts';

const JOB_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const LOG_TAIL_LINES = 80;
const POLL_MS = 2_000;
const MISS_LIMIT = 4;

export function detachedJobId(artifact: { id: string; kind: string }): string | null {
  if (artifact.kind !== 'log') return null;
  const id = artifact.id.startsWith('tool-') ? artifact.id.slice('tool-'.length) : '';
  if (!id || !JOB_ID_RE.test(id)) return null;
  return id;
}

export function jobLogPaths(jobId: string): { log: string; exit: string } {
  const base = `.context/.sideboard/detached-jobs/${jobId}`;
  return { log: `${base}/log`, exit: `${base}/exit` };
}

export function tailLog(text: string, maxLines = LOG_TAIL_LINES): string {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed) return '';
  const lines = trimmed.split('\n');
  if (lines.length <= maxLines) return trimmed;
  return lines.slice(-maxLines).join('\n');
}

/** File tail wins when the pane is empty or only holds a fragment of that tail. */
export function followLogContent(current: string, logText: string | null | undefined): string {
  const tailed = tailLog(logText ?? '');
  if (!tailed) return current;
  const cur = current.trim();
  if (!cur) return tailed;
  if (tailed.includes(cur)) return tailed;
  if (current.includes(tailed)) return current;
  return joinLogChunks(current, tailed);
}

export function parseExitCode(text: string | null | undefined): number | null {
  const raw = text?.trim() ?? '';
  if (!/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

export function applyDetachedJobSnapshot(
  artifact: ChatArtifact,
  snap: { log: string | null; exitCode: number | null },
): ChatArtifact {
  const content = followLogContent(artifact.content, snap.log);
  let status = artifact.status;
  if (status !== 'ok' && status !== 'failed' && snap.exitCode != null) {
    status = snap.exitCode === 0 ? 'ok' : 'failed';
  }
  if (content === artifact.content && status === artifact.status) return artifact;
  return { ...artifact, content, status };
}

type ReadFile = (
  threadId: string,
  path: string,
) => Promise<{ content: string; binary?: boolean }>;

function defaultReadFile(threadId: string, path: string) {
  return window.sideboard.readFile(threadId, path);
}

async function readOptional(
  readFile: ReadFile,
  threadId: string,
  path: string,
): Promise<string | null> {
  try {
    const file = await readFile(threadId, path);
    if (file.binary) return null;
    return file.content;
  } catch {
    return null;
  }
}

/**
 * While a job log is marked working, read its log and exit files.
 * Tool deltas stay empty during a quiet wait, and the pill never clears
 * if the agent stops polling after the process has already exited.
 */
export function useDetachedJobLog(
  artifact: ChatArtifact,
  threadId: string | undefined,
  readFile: ReadFile = defaultReadFile,
): ChatArtifact {
  const jobId = detachedJobId(artifact);
  const [snap, setSnap] = useState<{ log: string | null; exitCode: number | null } | null>(null);

  useEffect(() => {
    setSnap(null);
  }, [artifact.id]);

  const finished =
    artifact.status === 'ok' || artifact.status === 'failed' || snap?.exitCode != null;

  useEffect(() => {
    if (!threadId || !jobId || finished) return;
    let cancelled = false;
    let misses = 0;
    let timer = 0;
    const paths = jobLogPaths(jobId);
    const tick = async () => {
      const [log, exitText] = await Promise.all([
        readOptional(readFile, threadId, paths.log),
        readOptional(readFile, threadId, paths.exit),
      ]);
      if (cancelled) return;
      if (log == null && exitText == null) {
        misses += 1;
        if (misses >= MISS_LIMIT) return;
      } else {
        misses = 0;
        const exitCode = parseExitCode(exitText);
        setSnap({ log, exitCode });
        if (exitCode != null) return;
      }
      timer = window.setTimeout(() => {
        void tick();
      }, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [threadId, jobId, finished, artifact.id, readFile]);

  if (!snap) return artifact;
  return applyDetachedJobSnapshot(artifact, snap);
}
