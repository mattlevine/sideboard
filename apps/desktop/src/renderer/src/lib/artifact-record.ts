export type ArtifactLogStatus = 'running' | 'ok' | 'failed' | 'idle';

export function asRecord(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

export function parseMaybeJson(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function unwrapToolResultPayload(result: unknown): unknown {
  const parsed = parseMaybeJson(result);
  const rec = asRecord(parsed);
  if (!rec) return parsed;

  const collectTexts = (items: unknown[]): string[] => {
    const texts: string[] = [];
    for (const item of items) {
      const row = asRecord(item);
      if (!row) continue;
      if (typeof row.text === 'string') {
        texts.push(row.text);
        continue;
      }
      const nested = asRecord(row.text);
      if (typeof nested?.text === 'string') texts.push(nested.text);
    }
    return texts;
  };

  const value = asRecord(rec.value);
  if (value && Array.isArray(value.content)) {
    const texts = collectTexts(value.content);
    if (texts.length === 1) return parseMaybeJson(texts[0]);
    if (texts.length > 1) return texts.map((t) => parseMaybeJson(t));
  }
  if (Array.isArray(rec.content) && rec.content.every((c) => asRecord(c)?.text != null)) {
    const texts = collectTexts(rec.content);
    if (texts.length === 1) return parseMaybeJson(texts[0]);
    if (texts.length > 1) return texts.map((t) => parseMaybeJson(t));
  }
  return parsed;
}

export function parseLogStatus(value: unknown): ArtifactLogStatus | undefined {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (s === 'running' || s === 'working') return 'running';
  if (s === 'ok' || s === 'done') return 'ok';
  if (s === 'failed' || s === 'error') return 'failed';
  if (s === 'idle') return 'idle';
  return undefined;
}

/** Prefer stillRunning / ok / failed over a stale `status: running` field. */
export function inferJobLogStatus(payload: Record<string, unknown> | undefined): ArtifactLogStatus | undefined {
  if (!payload) return undefined;
  if (payload.stillRunning === true) return 'running';
  if (payload.ok === true) return 'ok';
  if (payload.failed === true || payload.stopped === true) return 'failed';
  const explicit = parseLogStatus(payload.status);
  if (explicit) return explicit;
  if (payload.started === true || payload.reason === 'already-running') return 'running';
  if (payload.stillRunning === false) return 'idle';
  return undefined;
}
