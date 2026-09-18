import { describe, expect, it } from 'vitest';
import { visibleComposerAttachments } from './composer-attachments';

const img = {
  id: 'img-1',
  name: 'shot.png',
  kind: 'file' as const,
  content: 'Image attached: shot.png',
};

describe('visibleComposerAttachments', () => {
  it('keeps staging that has not been sent', () => {
    expect(visibleComposerAttachments([img])).toEqual([img]);
  });

  it('hides an image already on the in-flight send or a user message', () => {
    expect(visibleComposerAttachments([img], { pending: [img] })).toEqual([]);
    expect(
      visibleComposerAttachments([img], {
        messages: [{ attachments: [img] }],
      }),
    ).toEqual([]);
  });

  it('still shows a newly dropped image', () => {
    const next = { ...img, id: 'img-2', name: 'two.png' };
    expect(
      visibleComposerAttachments([img, next], { pending: [img] }),
    ).toEqual([next]);
  });
});
