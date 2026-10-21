import { describe, expect, it } from 'vitest';
import {
  CURSOR_STREAM_CUTOFF_CONTINUE_LIMIT,
  createCursorStreamToolProgress,
  cursorModelDisplayName,
  formatCursorStreamIdleAfterToolsError,
  isCursorIdleAfterCompletedTool,
  looksLikeCursorStreamCutOff,
  looksLikeCursorStreamIdleAfterTools,
  nextCrashContinueCount,
  noteCursorAgentEvent,
} from './cursor-stream-cutoff.js';

describe('cursor-stream-cutoff', () => {
  it('does not treat idle-after-tools as an HTTP/2 cutoff', () => {
    const detail = 'Cursor run failed: Cursor stopped responding after a tool call (Grok 4.7)';
    expect(looksLikeCursorStreamIdleAfterTools(detail)).toBe(true);
    expect(looksLikeCursorStreamCutOff(detail)).toBe(false);
    expect(nextCrashContinueCount(detail, 0)).toBe(1);
    expect(nextCrashContinueCount(detail, 1)).toBeNull();
    expect(nextCrashContinueCount('Premature close', 0)).toBe(1);
    expect(nextCrashContinueCount('Premature close', CURSOR_STREAM_CUTOFF_CONTINUE_LIMIT - 1)).toBe(
      CURSOR_STREAM_CUTOFF_CONTINUE_LIMIT,
    );
  });

  it('labels Grok catalog ids and omits Auto', () => {
    expect(cursorModelDisplayName('grok-4.7')).toBe('Grok 4.7');
    expect(cursorModelDisplayName('auto')).toBe('');
    expect(formatCursorStreamIdleAfterToolsError('grok-4.7')).toBe(
      'Cursor stopped responding after a tool call (Grok 4.7)',
    );
    expect(formatCursorStreamIdleAfterToolsError('default')).toBe(
      'Cursor stopped responding after a tool call',
    );
  });

  it('treats idle after a completed tool with no follow-up text as a stall', () => {
    const state = createCursorStreamToolProgress();
    noteCursorAgentEvent(state, { type: 'stdout', data: 'I will check git status.' });
    noteCursorAgentEvent(state, {
      type: 'tool_result',
      data: undefined,
      partial: true,
    });
    expect(isCursorIdleAfterCompletedTool(state)).toBe(false);
    noteCursorAgentEvent(state, { type: 'tool_result' });
    expect(isCursorIdleAfterCompletedTool(state)).toBe(true);
    noteCursorAgentEvent(state, { type: 'thinking', data: 'still waiting on the model' });
    expect(isCursorIdleAfterCompletedTool(state)).toBe(true);
    noteCursorAgentEvent(state, {
      type: 'stdout',
      data: 'nested subagent',
      parentId: 'call-1',
    });
    expect(isCursorIdleAfterCompletedTool(state)).toBe(true);
    noteCursorAgentEvent(state, { type: 'stdout', data: 'Here is the review.' });
    expect(isCursorIdleAfterCompletedTool(state)).toBe(false);
  });
});
