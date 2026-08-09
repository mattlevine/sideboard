import type { ClipboardEvent } from 'react';
import type { ThreadAttachment } from '@sideboard-ai/core';

/** Paste this large → attach as a doc chip instead of flooding the composer. */
export const PASTE_ATTACH_MIN_CHARS = 1200;
/** Or this many lines (whichever hits first). */
export const PASTE_ATTACH_MIN_LINES = 15;

const PASTED_NAME_RE = /^Pasted text #(\d+)\.txt$/i;
const PASTED_NAME_ALT_RE = /^pasted-(\d+)\.txt$/i;

function pastedTextStats(text: string): { chars: number; lines: number } {
  const chars = text.length;
  if (chars === 0) return { chars: 0, lines: 0 };
  const lines = text.split(/\r\n|\r|\n/).length;
  return { chars, lines };
}

export function shouldAttachPastedText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const { chars, lines } = pastedTextStats(text);
  return chars >= PASTE_ATTACH_MIN_CHARS || lines >= PASTE_ATTACH_MIN_LINES;
}

export function nextPastedTextName(existing: Array<{ name: string }>): string {
  let max = 0;
  for (const a of existing) {
    const m = PASTED_NAME_RE.exec(a.name) ?? PASTED_NAME_ALT_RE.exec(a.name);
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `Pasted text #${max + 1}.txt`;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * If the clipboard holds a large text paste, preventDefault and return a
 * staging buffer for a FILE attachment chip. Returns null to keep default paste.
 */
export function largePasteBufferFromEvent(
  e: ClipboardEvent,
  existing: Array<{ name: string }>,
): { name: string; dataBase64: string } | null {
  const dt = e.clipboardData;
  if (!dt) return null;
  // Prefer OS file / image pastes over text-collapse.
  if (dt.files && dt.files.length > 0) return null;
  const text = dt.getData('text/plain');
  if (!shouldAttachPastedText(text)) return null;
  e.preventDefault();
  const name = nextPastedTextName(existing);
  return { name, dataBase64: utf8ToBase64(text) };
}

/** Build attachments for create-modal / no-worktree pastes via IPC buffers. */
export async function attachmentsFromLargePaste(
  e: ClipboardEvent,
  existing: ThreadAttachment[],
): Promise<ThreadAttachment[] | null> {
  const buf = largePasteBufferFromEvent(e, existing);
  if (!buf) return null;
  return window.sideboard.attachmentsFromBuffers([buf]);
}
