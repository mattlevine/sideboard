import { describe, expect, it } from 'vitest';
import type { MessagePart } from '../types/thread.js';
import { applyAgentEvent, partsToAssistantText } from './message-parts.js';
import { foldDuplicateStdout, textSoFar } from './stdout-replay.js';

const paragraph =
  'The release is still queued. GitHub has not assigned a runner, so notarization has not started.\n\n' +
  'Both jobs have been waiting since early afternoon. Cancelling now would only send the tag back into the same queue.';

function absorb(parts: MessagePart[], data: string, parentId?: string): MessagePart[] {
  const folded = foldDuplicateStdout(textSoFar(parts, parentId), data);
  if (folded == null) return parts;
  return applyAgentEvent(parts, {
    type: 'stdout',
    data: folded,
    ...(parentId ? { parentId } : {}),
  });
}

describe('foldDuplicateStdout', () => {
  it('keeps a repeated letter while tokens stream', () => {
    let parts: MessagePart[] = [];
    for (const ch of 'letter') parts = absorb(parts, ch);
    expect(partsToAssistantText(parts)).toBe('letter');
  });

  it('drops a full snapshot and a result that only adds a trailing newline', () => {
    let parts: MessagePart[] = [];
    for (const chunk of [paragraph.slice(0, 40), paragraph.slice(40)]) {
      parts = absorb(parts, chunk);
    }
    const once = partsToAssistantText(parts);
    parts = absorb(parts, once);
    parts = absorb(parts, `${once}\n`);
    expect(partsToAssistantText(parts)).toBe(once);
  });

  it('drops an earlier block of paragraphs replayed after later text', () => {
    const later =
      'Say when you want the same tag pushed again. The new Apple password was never tested.';
    let parts = absorb([], `${paragraph}\n\n`);
    parts = absorb(parts, later);
    parts = absorb(parts, paragraph);
    const text = partsToAssistantText(parts);
    expect(text.match(/The release is still queued/g)).toHaveLength(1);
    expect(text).toContain(later);
  });

  it('keeps only the new tail of a longer snapshot', () => {
    let parts = absorb([], paragraph);
    const more =
      'The watcher stays attached and will keep going once a runner picks the jobs up.';
    parts = absorb(parts, `${paragraph}\n\n${more}`);
    const text = partsToAssistantText(parts);
    expect(text.match(/The release is still queued/g)).toHaveLength(1);
    expect(text).toContain(more);
  });

  it('does not append a snapshot that repeats the answer and then adds a paragraph', () => {
    let parts = absorb([], paragraph);
    const more = 'Nothing is running on our side until the tag is pushed again.';
    parts = absorb(parts, `${paragraph}${paragraph}\n\n${more}`);
    const text = partsToAssistantText(parts);
    expect(text.match(/The release is still queued/g)).toHaveLength(1);
    expect(text).toContain(more);
  });

  it('still appends a new paragraph that was not streamed', () => {
    const more = 'A brand new paragraph that the snapshot did not already contain anywhere above.';
    let parts = absorb([], paragraph);
    parts = absorb(parts, more);
    expect(partsToAssistantText(parts)).toBe(`${paragraph}${more}`);
  });

  it('does not treat another nested stream as the parent answer', () => {
    let parts = absorb([], paragraph);
    parts = absorb(parts, paragraph, 'tool-1');
    expect(partsToAssistantText(parts)).toBe(paragraph);
    const nested = parts.find((p) => p.type === 'text' && p.parentId === 'tool-1');
    expect(nested && nested.type === 'text' ? nested.text : '').toBe(paragraph);
  });
});
