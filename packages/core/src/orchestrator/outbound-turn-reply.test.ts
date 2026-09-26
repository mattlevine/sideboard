import { describe, expect, it } from 'vitest';
import { outboundReplyFromTurn } from './outbound-turn-reply.js';

const copy = {
  inputRequired: 'WAIT_MAC',
  canceled: 'CANCELED',
  failed: (detail: string) => (detail ? `FAILED ${detail}` : 'FAILED'),
  completedEmpty: (status: string) => `EMPTY ${status}`,
};

describe('outboundReplyFromTurn', () => {
  it('posts the assistant text on completed', () => {
    expect(
      outboundReplyFromTurn(
        { text: '  ship it  ', status: 'idle', taskState: 'completed' },
        copy,
      ),
    ).toBe('ship it');
  });

  it('uses completedEmpty when completed text is blank', () => {
    expect(
      outboundReplyFromTurn(
        { text: '', status: 'idle', taskState: 'completed' },
        copy,
      ),
    ).toBe('EMPTY idle');
  });

  it('never posts ask_user picker text on input-required', () => {
    expect(
      outboundReplyFromTurn(
        {
          text: 'Pick a workspace',
          status: 'idle',
          taskState: 'input-required',
        },
        copy,
      ),
    ).toBe('WAIT_MAC');
  });

  it('posts the canceled copy, not leftover stream text', () => {
    expect(
      outboundReplyFromTurn(
        { text: 'almost done', status: 'stopped', taskState: 'canceled' },
        copy,
      ),
    ).toBe('CANCELED');
  });

  it('prefers lastError on failed', () => {
    expect(
      outboundReplyFromTurn(
        {
          text: 'partial',
          status: 'error',
          taskState: 'failed',
          lastError: 'spawn failed',
        },
        copy,
      ),
    ).toBe('FAILED spawn failed');
  });

  it('falls back to leftover text when failed has no lastError', () => {
    expect(
      outboundReplyFromTurn(
        { text: 'boom', status: 'error', taskState: 'failed', lastError: null },
        copy,
      ),
    ).toBe('FAILED boom');
  });

  it('treats a still-running snapshot after wait as failed', () => {
    expect(
      outboundReplyFromTurn(
        { text: 'streaming…', status: 'running', taskState: 'working' },
        copy,
      ),
    ).toBe('FAILED turn still working');
  });
});
