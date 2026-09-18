import { describe, expect, it } from 'vitest';
import {
  consumeComposerAttachments,
  takePendingTurnAttachments,
} from './consume-attachments.js';
import type { ThreadAttachment } from '../types/thread.js';

const img: ThreadAttachment = {
  id: 'img-1',
  name: 'shot.png',
  kind: 'file',
  content: 'Image attached: shot.png',
  previewDataUrl: 'data:image/png;base64,xx',
};

describe('consumeComposerAttachments', () => {
  it('leaves an empty composer alone', () => {
    expect(consumeComposerAttachments({ attachments: [] })).toEqual({
      attachments: [],
      pendingTurnAttachments: [],
    });
  });

  it('clears the composer and parks the image for the next turn', () => {
    expect(consumeComposerAttachments({ attachments: [img] })).toEqual({
      attachments: [],
      pendingTurnAttachments: [img],
    });
  });

  it('appends onto attachments already waiting for a queued turn', () => {
    const extra: ThreadAttachment = { ...img, id: 'img-2', name: 'two.png' };
    expect(
      consumeComposerAttachments({
        attachments: [extra],
        pendingTurnAttachments: [img],
      }),
    ).toEqual({
      attachments: [],
      pendingTurnAttachments: [img, extra],
    });
  });
});

describe('takePendingTurnAttachments', () => {
  it('prefers parked send snapshots and still picks up leftover staging', () => {
    const extra: ThreadAttachment = { ...img, id: 'img-2', name: 'two.png' };
    expect(
      takePendingTurnAttachments({
        attachments: [extra],
        pendingTurnAttachments: [img],
      }),
    ).toEqual([img, extra]);
    expect(takePendingTurnAttachments({ attachments: [] })).toEqual([]);
  });
});
