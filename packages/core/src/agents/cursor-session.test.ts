import { describe, expect, it, vi } from 'vitest';
import {
  CURSOR_STREAM_IDLE_MS,
  cursorErrorMessage,
  cursorSendOptions,
  cursorSessionRecoveryMessage,
  isAgentBusyError,
  isUnresumableCursorSession,
  iterateUntilIdle,
  withCursorLocalHangGuards,
} from './cursor-session.js';

describe('isAgentBusyError', () => {
  it('detects the SDK active-run conflict message', () => {
    expect(
      isAgentBusyError(
        new Error('Agent agent-e721fcef-4894-423c-ac9d-58382e7d9835 already has active run'),
      ),
    ).toBe(true);
    expect(isAgentBusyError(Object.assign(new Error('busy'), { name: 'AgentBusyError' }))).toBe(
      true,
    );
  });

  it('ignores unrelated errors', () => {
    expect(isAgentBusyError(new Error('Agent agent-1 not found'))).toBe(false);
    expect(isAgentBusyError(new Error('invalid API key'))).toBe(false);
  });
});

describe('isUnresumableCursorSession', () => {
  it('detects missing cloud / cwd agent ids', () => {
    expect(
      isUnresumableCursorSession(
        new Error('Agent agent-1ff554d1-14d1-42ff-9034-b9d2fe69e5f2 not found'),
      ),
    ).toBe(true);
    expect(
      isUnresumableCursorSession(
        Object.assign(new Error('gone'), { name: 'AgentNotFoundError' }),
      ),
    ).toBe(true);
  });

  it('detects corrupt local JSONL checkpoints', () => {
    expect(
      isUnresumableCursorSession(
        new Error(
          'Corrupt local agent checkpoint: missing root blob 52f9ce3384de6735ceb611b8b38704ca5f589260ac68e9d5a6bb6578ceff2130 for agent agent-250b79b9-aa90-4f50-9558-9b0914a563f6',
        ),
      ),
    ).toBe(true);
    expect(
      isUnresumableCursorSession(
        new Error('Cursor startup failed: missing root blob abc for agent agent-1'),
      ),
    ).toBe(true);
  });

  it('ignores auth, model, and busy failures', () => {
    expect(isUnresumableCursorSession(new Error('invalid API key'))).toBe(false);
    expect(isUnresumableCursorSession(new Error('model gpt-x not found'))).toBe(false);
    expect(isUnresumableCursorSession(new Error('already has active run'))).toBe(false);
    expect(isUnresumableCursorSession(new Error('Credit balance is too low'))).toBe(false);
  });
});

describe('cursorSessionRecoveryMessage', () => {
  it('includes the previous agent id when resuming', () => {
    expect(
      cursorSessionRecoveryMessage(new Error('Agent agent-1 not found'), 'agent-1'),
    ).toMatch(/agent-1 is unresumable.*starting a new session/i);
  });

  it('still explains create-path failures', () => {
    expect(cursorSessionRecoveryMessage(new Error('missing root blob x'), null)).toMatch(
      /starting a new session/i,
    );
  });

  it('stringifies non-Error values', () => {
    expect(cursorErrorMessage('plain')).toBe('plain');
  });
});

describe('cursorSendOptions / withCursorLocalHangGuards', () => {
  it('expires a leftover local run on every send', () => {
    expect(cursorSendOptions()).toEqual({ local: { force: true } });
    expect(cursorSendOptions({ sideboard: { command: 'sideboard' } })).toEqual({
      local: { force: true },
      mcpServers: { sideboard: { command: 'sideboard' } },
    });
    expect(cursorSendOptions({})).toEqual({ local: { force: true } });
  });

  it('disables SDK stall auto-retry on create/resume local options', () => {
    expect(withCursorLocalHangGuards({ cwd: '/tmp/wt' })).toEqual({
      cwd: '/tmp/wt',
      enableAgentRetries: false,
    });
  });
});

describe('iterateUntilIdle', () => {
  it('yields items then stops when the source ends', async () => {
    async function* src() {
      yield 1;
      yield 2;
    }
    const out: number[] = [];
    for await (const n of iterateUntilIdle(src(), 1_000)) out.push(n);
    expect(out).toEqual([1, 2]);
  });

  it('stops after idleMs of silence', async () => {
    async function* src() {
      yield 'a';
      await new Promise((r) => setTimeout(r, 80));
      yield 'b';
    }
    const idle = vi.fn();
    const out: string[] = [];
    for await (const n of iterateUntilIdle(src(), 20, idle)) out.push(n);
    expect(out).toEqual(['a']);
    expect(idle).toHaveBeenCalledOnce();
  });

  it('exports a multi-minute default', () => {
    expect(CURSOR_STREAM_IDLE_MS).toBe(180_000);
  });
});
