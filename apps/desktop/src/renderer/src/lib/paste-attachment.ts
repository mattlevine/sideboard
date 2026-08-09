import type { ClipboardEvent } from 'react';
import {
  nextPastedTextName,
  shouldAttachPastedText,
  type ThreadAttachment,
} from '@sideboard-ai/core';

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
