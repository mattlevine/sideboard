import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptForJoinedSteer, reuseJoinedUserBubble } from './enqueue-thread-send.js';

describe('reuseJoinedUserBubble', () => {
  it('reuses a rewritten user prompt above a partial agent reply', () => {
    const reused = new Set(['t1']);
    expect(
      reuseJoinedUserBubble(
        reused,
        't1',
        [
          { role: 'user', text: 'Work on issue A\nAnd B', ts: '1' },
          { role: 'agent', text: 'partial', ts: '2' },
        ],
        'Work on issue A\nAnd B',
      ),
    ).toBe(true);
    expect(reused.has('t1')).toBe(false);
  });

  it('appends when the latest user message is a different prompt', () => {
    const reused = new Set(['t1']);
    expect(
      reuseJoinedUserBubble(
        reused,
        't1',
        [
          { role: 'user', text: 'Work on issue A', ts: '1' },
          { role: 'agent', text: 'partial', ts: '2' },
        ],
        'Work on issue A\nAnd B',
      ),
    ).toBe(false);
  });
});

describe('promptForJoinedSteer', () => {
  it('includes a follow-up image when the joined text was already expanded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'steer-image-'));
    const img = {
      id: 'img-1',
      name: 'shot.png',
      kind: 'file' as const,
      content: 'Image attached: shot.png',
      previewDataUrl: 'data:image/png;base64,xx',
    };
    const baked = 'Work on issue A\nAnd B';
    const result = promptForJoinedSteer({
      threadId: 't1',
      promptText: baked,
      latestPrompt: baked,
      agentPrompt: `prefix\n\n${baked}`,
      expandedPrompt: baked,
      worktreePath: dir,
      attachments: [],
      latestAttachments: [img],
    });
    expect(result).toContain('prefix');
    expect(result).toContain('And B');
    expect(result).toContain('shot.png');
    expect(result).toContain('Image attached');
  });
});
