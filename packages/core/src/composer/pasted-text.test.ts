import { describe, expect, it } from 'vitest';
import {
  buildPastedTextAttachment,
  nextPastedTextName,
  PASTE_ATTACH_MIN_CHARS,
  PASTE_ATTACH_MIN_LINES,
  shouldAttachPastedText,
} from './pasted-text.js';

describe('pasted-text', () => {
  it('keeps short pastes inline', () => {
    expect(shouldAttachPastedText('hello world')).toBe(false);
    expect(shouldAttachPastedText('a\nb\nc')).toBe(false);
  });

  it('attaches when character threshold is hit', () => {
    expect(shouldAttachPastedText('x'.repeat(PASTE_ATTACH_MIN_CHARS))).toBe(true);
  });

  it('attaches when line threshold is hit', () => {
    const lines = Array.from({ length: PASTE_ATTACH_MIN_LINES }, (_, i) => `line ${i}`).join(
      '\n',
    );
    expect(shouldAttachPastedText(lines)).toBe(true);
  });

  it('ignores whitespace-only pastes', () => {
    expect(shouldAttachPastedText('   \n\n  ')).toBe(false);
  });

  it('increments Pasted text #N names', () => {
    expect(nextPastedTextName([])).toBe('Pasted text #1.txt');
    expect(
      nextPastedTextName([
        { name: 'Pasted text #1.txt' },
        { name: 'notes.md' },
        { name: 'pasted-3.txt' },
      ]),
    ).toBe('Pasted text #4.txt');
  });

  it('builds a file attachment with the paste body', () => {
    const att = buildPastedTextAttachment('body here', { name: 'Pasted text #2.txt' });
    expect(att.kind).toBe('file');
    expect(att.name).toBe('Pasted text #2.txt');
    expect(att.content).toBe('body here');
    expect(att.id).toBeTruthy();
  });
});
