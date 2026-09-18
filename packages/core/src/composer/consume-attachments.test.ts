import { describe, expect, it } from 'vitest';
import {
  appendQueuedItem,
  consumeComposerAttachments,
  moveQueuedItemToFront,
  removeQueuedItem,
  shiftQueuedItem,
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

const extra: ThreadAttachment = { ...img, id: 'img-2', name: 'two.png' };

describe('consumeComposerAttachments', () => {
  it('leaves an empty composer alone', () => {
    expect(consumeComposerAttachments({ attachments: [] })).toEqual({
      attachments: [],
      consumed: [],
    });
  });

  it('clears the composer and returns the staged files', () => {
    expect(consumeComposerAttachments({ attachments: [img] })).toEqual({
      attachments: [],
      consumed: [img],
    });
  });
});

describe('takePendingTurnAttachments', () => {
  it('does not steal leftover composer files after a parked send', () => {
    expect(
      takePendingTurnAttachments({
        attachments: [extra],
        pendingTurnAttachments: [img],
      }),
    ).toEqual([img]);
  });

  it('falls back to composer staging when nothing is parked', () => {
    expect(takePendingTurnAttachments({ attachments: [img] })).toEqual([img]);
    expect(takePendingTurnAttachments({ attachments: [] })).toEqual([]);
  });
});

describe('queue attachment helpers', () => {
  it('parks consumed files on the new queue item', () => {
    expect(appendQueuedItem(['first'], undefined, 'look', [img])).toEqual({
      queue: ['first', 'look'],
      queueAttachments: [[], [img]],
    });
  });

  it('drops parked files when that queued prompt is removed', () => {
    const queued = appendQueuedItem(['first'], undefined, 'look', [img]);
    expect(removeQueuedItem(queued.queue, queued.queueAttachments, 1)).toEqual({
      queue: ['first'],
      queueAttachments: [[]],
    });
  });

  it('moves parked files with Send now', () => {
    const queued = appendQueuedItem(['first'], undefined, 'look', [img]);
    expect(moveQueuedItemToFront(queued.queue, queued.queueAttachments, 1)).toEqual({
      queue: ['look', 'first'],
      queueAttachments: [[img], []],
    });
  });

  it('shifts the next prompt and its files off the queue', () => {
    const queued = appendQueuedItem([], undefined, 'look', [img]);
    expect(shiftQueuedItem(queued.queue, queued.queueAttachments)).toEqual({
      prompt: 'look',
      attachments: [img],
      queue: [],
      queueAttachments: [],
    });
  });
});
