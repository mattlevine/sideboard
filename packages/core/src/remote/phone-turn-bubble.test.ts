import { describe, expect, it } from 'vitest';
import { applyPhoneTurn, finishAgent, phoneTurnPatch } from '../../../../apps/mobile/transcript.ts';

const app = { id: 'toolu_1', tool: 'mcp__dice__roll' };

describe('finishAgent', () => {
  it('keeps an MCP app when the finished turn has no text', () => {
    const streaming = [{ id: 'live', role: 'agent' as const, text: '', streaming: true }];
    expect(finishAgent(streaming, '', [app])).toEqual([
      { id: 'live', role: 'agent', text: '', streaming: false, apps: [app] },
    ]);
    expect(finishAgent([], '  ', [app])).toEqual([{ id: 'app-0', role: 'agent', text: '', apps: [app] }]);
  });
});

describe('phone ask refresh', () => {
  it('does not clear the transcript or the sidebar snippet for an empty ask', () => {
    const bubbles = [{ id: 'live', role: 'agent' as const, text: 'still here', streaming: true }];
    const questions = [{ question: 'Which API?', options: [{ label: 'REST' }] }];
    expect(phoneTurnPatch('ask', '')).toEqual({ refreshQuestionsOnly: true });
    expect(
      applyPhoneTurn(
        { bubbles, questions: null, working: true, activity: 'thinking' },
        { op: 'ask', text: '', questions },
      ),
    ).toEqual({ bubbles, questions, working: false, activity: '' });
  });

  it('still records a real assistant reply', () => {
    expect(phoneTurnPatch('assistant', 'Done.')).toEqual({
      refreshQuestionsOnly: false,
      status: 'idle',
      preview: 'Done.',
    });
    expect(phoneTurnPatch('assistant', '   ')).toEqual({ refreshQuestionsOnly: false, status: 'idle' });
  });
});
