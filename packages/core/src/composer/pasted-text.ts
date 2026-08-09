import { randomUUID } from 'node:crypto';
import type { ThreadAttachment } from '../types/thread.js';

/** Paste this large → attach as a doc chip instead of flooding the composer. */
export const PASTE_ATTACH_MIN_CHARS = 1200;
/** Or this many lines (whichever hits first). */
export const PASTE_ATTACH_MIN_LINES = 15;

const PASTED_NAME_RE = /^Pasted text #(\d+)\.txt$/i;
const PASTED_NAME_ALT_RE = /^pasted-(\d+)\.txt$/i;

export function pastedTextStats(text: string): { chars: number; lines: number } {
  const chars = text.length;
  if (chars === 0) return { chars: 0, lines: 0 };
  const lines = text.split(/\r\n|\r|\n/).length;
  return { chars, lines };
}

/**
 * True when clipboard text is large enough that Claude-style doc attachment
 * is preferable to dumping it into the message input.
 */
export function shouldAttachPastedText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const { chars, lines } = pastedTextStats(text);
  return chars >= PASTE_ATTACH_MIN_CHARS || lines >= PASTE_ATTACH_MIN_LINES;
}

/** Next `Pasted text #N.txt` name given existing composer attachments. */
export function nextPastedTextName(existing: Array<{ name: string }>): string {
  let max = 0;
  for (const a of existing) {
    const m = PASTED_NAME_RE.exec(a.name) ?? PASTED_NAME_ALT_RE.exec(a.name);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `Pasted text #${max + 1}.txt`;
}

/**
 * Build a file-kind attachment for a large paste. Content is expanded into the
 * agent prompt via `expandComposerPrompt` like other composer attachments.
 */
export function buildPastedTextAttachment(
  text: string,
  opts?: { name?: string; id?: string; path?: string },
): ThreadAttachment {
  return {
    id: opts?.id ?? randomUUID(),
    name: opts?.name ?? 'Pasted text #1.txt',
    kind: 'file',
    path: opts?.path,
    content: text,
  };
}
