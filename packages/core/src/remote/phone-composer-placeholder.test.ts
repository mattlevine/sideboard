import { describe, expect, it } from 'vitest';
import { composerPlaceholder } from '../../../../apps/mobile/labels.ts';

describe('composerPlaceholder', () => {
  it('says a running chat will steer, and queues only when the Mac is set to queue', () => {
    expect(composerPlaceholder({ orchestration: false, status: 'running' })).toBe(
      'Steer — send now to add to the chat…',
    );
    expect(composerPlaceholder({ orchestration: false, status: 'queued', followUp: 'steer' })).toBe(
      'Steer — send now to add to the chat…',
    );
    expect(composerPlaceholder({ orchestration: false, status: 'running', followUp: 'queue' })).toBe(
      'Queued when you send…',
    );
  });

  it('keeps the idle hints', () => {
    expect(composerPlaceholder({ orchestration: true, status: 'idle' })).toBe(
      'Describe a goal — spawn and steer worktree agents via MCP',
    );
    expect(composerPlaceholder({ orchestration: false })).toBe(
      'Ask to make changes, @mention files, run /commands',
    );
  });
});
