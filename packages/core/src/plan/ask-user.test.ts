import { describe, expect, it } from 'vitest';
import {
  extractPendingPlanQuestions,
  formatPlanQuestionAnswers,
  formatPlanQuestionsForChat,
  isAskUserToolName,
  isPlanQuestionAnswersMessage,
  latestPendingPlanQuestions,
  parsePlanQuestionsInput,
  planQuestionsSignature,
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

  it('keeps markdown in question and option copy', () => {
    const qs = parsePlanQuestionsInput({
      questions: [
        {
          question: 'Use `AskUserQuestion` or **ask_user**?',
          options: [
            {
              label: '`packages/core`',
              description: 'Shared parser — **preferred** for both agents',
            },
            { label: 'Desktop only' },
          ],
        },
      ],
    });
    expect(qs[0]!.question).toContain('**ask_user**');
    expect(qs[0]!.options[0]!.label).toBe('`packages/core`');
    expect(qs[0]!.options[0]!.description).toContain('**preferred**');
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
    expect(pending?.signature).toBe(
      planQuestionsSignature(pending!.questions),
    );
    expect(pending?.questions[0]!.options).toHaveLength(2);
  });

  it('recognizes mcp ask_user tool names', () => {
    expect(isAskUserToolName('mcp__sideboard__ask_user')).toBe(true);
    expect(isAskUserToolName('ask_user')).toBe(true);
    expect(isAskUserToolName('Bash')).toBe(false);
  });
});

const askPart = {
  type: 'tool',
  id: 'q1',
  name: 'ask_user',
  input: {
    questions: [
      {
        question: 'Which column set?',
        options: [{ label: 'Four' }, { label: 'Five' }],
      },
    ],
  },
  status: 'done',
};

describe('latestPendingPlanQuestions', () => {
  it('is pending on the agent turn that asked', () => {
    const pending = latestPendingPlanQuestions({
      messages: [{ role: 'agent', parts: [askPart] }],
    });
    expect(pending?.questions[0]!.question).toContain('column');
  });

  it('clears after a user reply in the transcript', () => {
    expect(
      latestPendingPlanQuestions({
        messages: [
          { role: 'agent', parts: [askPart] },
          { role: 'user' },
        ],
      }),
    ).toBeNull();
  });

  it('clears when a composer send is in flight', () => {
    expect(
      latestPendingPlanQuestions({
        messages: [{ role: 'agent', parts: [askPart] }],
        liveParts: [askPart],
        userReplied: true,
      }),
    ).toBeNull();
  });

  it('prefers live parts on the current turn', () => {
    const pending = latestPendingPlanQuestions({
      messages: [{ role: 'user' }],
      liveParts: [askPart],
    });
    expect(pending?.id).toBe('q1');
  });

  it('reads questions from the tool result when input was not stored', () => {
    const pending = extractPendingPlanQuestions([
      {
        type: 'tool',
        id: 'q-result',
        name: 'mcp__sideboard__ask_user',
        status: 'done',
        result: JSON.stringify({
          ok: true,
          questions: [
            {
              question: 'Which API?',
              options: [{ label: 'REST' }, { label: 'GraphQL' }],
            },
          ],
        }),
      },
    ]);
    expect(pending?.questions[0]?.question).toBe('Which API?');
    expect(pending?.id).toBe('q-result');
  });

  it('shows the sidebar ask in chat when the transcript never stored it', () => {
    const questions = [
      {
        question: 'Which API?',
        options: [{ label: 'REST' }, { label: 'GraphQL' }],
      },
    ];
    const pending = latestPendingPlanQuestions({
      messages: [{ role: 'user', ts: '2026-10-20T00:00:00.000Z' }],
      agentBlock: {
        source: 'ask_user',
        at: '2026-10-20T00:01:00.000Z',
        questionSignature: 'sig',
        questions,
      },
    });
    expect(pending?.questions).toEqual(questions);
    expect(pending?.signature).toBe('sig');
  });

  it('keeps the sidebar ask across a host continue prompt', () => {
    const questions = [
      {
        question: 'Which API?',
        options: [{ label: 'REST' }, { label: 'GraphQL' }],
      },
    ];
    const pending = latestPendingPlanQuestions({
      messages: [
        { role: 'user', ts: '2026-10-20T00:00:00.000Z' },
        { role: 'agent', ts: '2026-10-20T00:01:00.000Z' },
        {
          role: 'user',
          ts: '2026-10-20T00:02:00.000Z',
          origin: 'continue',
        },
      ],
      agentBlock: {
        source: 'ask_user',
        at: '2026-10-20T00:01:00.000Z',
        questionSignature: 'sig',
        questions,
      },
    });
    expect(pending?.signature).toBe('sig');
  });

  it('hides a sidebar ask after a later user message', () => {
    expect(
      latestPendingPlanQuestions({
        messages: [
          { role: 'agent', ts: '2026-10-20T00:01:00.000Z' },
          { role: 'user', ts: '2026-10-20T00:02:00.000Z' },
        ],
        agentBlock: {
          source: 'ask_user',
          at: '2026-10-20T00:01:00.000Z',
          questionSignature: 'sig',
          questions: [
            {
              question: 'Which API?',
              options: [{ label: 'REST' }, { label: 'GraphQL' }],
            },
          ],
        },
      }),
    ).toBeNull();
  });

  it('hides a sidebar ask the user already skipped', () => {
    expect(
      latestPendingPlanQuestions({
        messages: [{ role: 'agent', ts: '2026-10-20T00:01:00.000Z' }],
        agentBlock: {
          source: 'ask_user',
          at: '2026-10-20T00:01:00.000Z',
          questionSignature: 'sig',
          questions: [
            {
              question: 'Which API?',
              options: [{ label: 'REST' }, { label: 'GraphQL' }],
            },
          ],
        },
        dismissedQuestionSignature: 'sig',
      }),
    ).toBeNull();
  });

  it('does not use a mid-turn stamp until the ask is the last live tool', () => {
    const questions = [
      {
        question: 'Which API?',
        options: [{ label: 'REST' }, { label: 'GraphQL' }],
      },
    ];
    const stamp = {
      source: 'ask_user' as const,
      at: '2026-10-20T00:01:00.000Z',
      questionSignature: 'sig',
      questions,
    };
    expect(
      latestPendingPlanQuestions({
        messages: [{ role: 'user', ts: '2026-10-20T00:00:00.000Z' }],
        agentBlock: stamp,
        status: 'running',
      }),
    ).toBeNull();
    expect(
      latestPendingPlanQuestions({
        messages: [{ role: 'user', ts: '2026-10-20T00:00:00.000Z' }],
        liveParts: [askPart],
        agentBlock: stamp,
        status: 'running',
      })?.id,
    ).toBe('q1');
  });

  it('hides the ask once a later tool runs', () => {
    const later = { type: 'tool' as const, id: 'r1', name: 'Read', status: 'done' as const };
    expect(
      latestPendingPlanQuestions({
        messages: [{ role: 'user' }],
        liveParts: [askPart, later],
        status: 'running',
      }),
    ).toBeNull();
    expect(
      latestPendingPlanQuestions({
        messages: [{ role: 'agent', parts: [askPart, later] }],
      }),
    ).toBeNull();
  });
});

describe('formatPlanQuestionAnswers', () => {
  it('emits markdown the chat bubble can render', () => {
    const md = formatPlanQuestionAnswers(
      [
        {
          question: 'Which **auth**?',
          header: 'Auth',
          options: [{ label: 'OAuth' }, { label: 'API key' }],
        },
      ],
      [{ questionIndex: 0, selected: ['OAuth'] }],
    );
    expect(isPlanQuestionAnswersMessage(md)).toBe(true);
    expect(md).toContain('**Auth**');
    expect(md).toContain('Which **auth**?');
    expect(md).toContain('OAuth');
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
