/** A phone file selection. The Mac turns it into the same code-ref attachment as the desktop. */
export interface PhoneCodeRef {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

const MAX_REFS = 8;
const MAX_TEXT = 20_000;
const MAX_TOTAL = 40_000;

function lineNumber(value: object, key: string): number | undefined {
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 1_000_000) return undefined;
  return raw;
}

/** Keep code refs on a prompt. Anything else is dropped as invalid. */
export function parsePhoneCodeRefs(value: unknown): PhoneCodeRef[] | 'invalid' {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_REFS) return 'invalid';
  const refs: PhoneCodeRef[] = [];
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') return 'invalid';
    const pathRaw = (item as { path?: unknown }).path;
    const path = typeof pathRaw === 'string' ? pathRaw.trim().replace(/\\/g, '/').slice(0, 500) : '';
    const startLine = lineNumber(item, 'startLine');
    const endLine = lineNumber(item, 'endLine');
    const textRaw = (item as { text?: unknown }).text;
    const text = typeof textRaw === 'string' ? textRaw.replace(/\n$/, '').slice(0, MAX_TEXT) : '';
    if (!path || !startLine || !endLine || endLine < startLine || !text.trim()) return 'invalid';
    total += text.length;
    if (total > MAX_TOTAL) return 'invalid';
    refs.push({ path, startLine, endLine, text });
  }
  return refs;
}
