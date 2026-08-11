import { describe, expect, it } from 'vitest';
import {
  extractPendingPlanQuestions,
  formatPlanQuestionAnswers,
  formatPlanQuestionsForChat,
  isAskUserToolName,
  parsePlanQuestionsInput,
} from './ask-user.js';

describe('parsePlanQuestionsInput', () => {
  it('parses AskUserQuestion-style payload', () => {
    const qs = parsePlanQuestionsInput({
      questions: [
        {
          question: 'Which auth?',
          header: 'Auth',
          multiSelect: false,
          options: [
            { label: 'OAuth', description: 'Browser login' },
            { label: 'API key' },
          ],
        },
      ],
    });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.question).toBe('Which auth?');
    expect(qs[0]!.options[0]!.label).toBe('OAuth');
  });
});

describe('extractPendingPlanQuestions', () => {
  it('finds the latest ask_user tool part', () => {
    const pending = extractPendingPlanQuestions([
      {
        type: 'tool',
        id: 'old',
        name: 'Read',
        input: {},
        status: 'done',
      },
      {
        type: 'tool',
        id: 'q1',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Pick one?',
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        },
        status: 'running',
      },
    ]);
    expect(pending?.id).toBe('q1');
    expect(pending?.questions[0]!.options).toHaveLength(2);
  });

  it('recognizes mcp ask_user tool names', () => {
    expect(isAskUserToolName('mcp__sideboard__ask_user')).toBe(true);
    expect(isAskUserToolName('ask_user')).toBe(true);
    expect(isAskUserToolName('Bash')).toBe(false);
  });
});

describe('formatPlanQuestionsForChat', () => {
  it('lists options with descriptions', () => {
    const md = formatPlanQuestionsForChat([
      {
        question: 'Which auth?',
        header: 'Auth',
        options: [
          { label: 'OAuth', description: 'Browser login' },
          { label: 'API key' },
        ],
      },
    ]);
    expect(md).toContain('Which auth?');
    expect(md).toContain('OAuth');
    expect(md).toContain('Browser login');
    expect(md).toContain('API key');
  });
});
