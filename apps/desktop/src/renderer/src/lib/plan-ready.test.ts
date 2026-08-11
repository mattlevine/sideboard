import { describe, expect, it } from 'vitest';
import {
  isPlanAwaitingApproval,
  latestPlanText,
  latestPresentedPlan,
  partsIncludeExitPlanMode,
  partsIncludePresentPlan,
} from './plan-ready';

describe('partsIncludeExitPlanMode', () => {
  it('detects ExitPlanMode tool parts', () => {
    expect(
      partsIncludeExitPlanMode([
        { type: 'tool', id: '1', name: 'ExitPlanMode', status: 'done' },
      ]),
    ).toBe(true);
    expect(
      partsIncludeExitPlanMode([
        { type: 'tool', id: '1', name: 'Read', status: 'done' },
      ]),
    ).toBe(false);
  });
});

describe('partsIncludePresentPlan', () => {
  it('detects present_plan tool parts', () => {
    expect(
      partsIncludePresentPlan([
        {
          type: 'tool',
          id: '1',
          name: 'present_plan',
          status: 'done',
          input: { content: '# Plan' },
        },
      ]),
    ).toBe(true);
  });
});

describe('isPlanAwaitingApproval', () => {
  it('requires plan mode and an exit-plan signal', () => {
    expect(
      isPlanAwaitingApproval({
        planMode: true,
        status: 'idle',
        messages: [
          {
            role: 'agent',
            text: 'Here is the plan…',
            parts: [
              { type: 'tool', id: '1', name: 'ExitPlanMode', status: 'done' },
            ],
            ts: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ).toBe(true);
    expect(
      isPlanAwaitingApproval({
        planMode: false,
        status: 'idle',
        messages: [
          {
            role: 'agent',
            text: 'Here is the plan…',
            parts: [
              { type: 'tool', id: '1', name: 'ExitPlanMode', status: 'done' },
            ],
            ts: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ).toBe(false);
  });

  it('treats present_plan as ready', () => {
    expect(
      isPlanAwaitingApproval({
        planMode: true,
        status: 'idle',
        messages: [
          {
            role: 'agent',
            text: 'Ready.',
            parts: [
              {
                type: 'tool',
                id: '1',
                name: 'mcp__sideboard__present_plan',
                status: 'done',
                input: { title: 'Ship', content: '# Steps\n1. Do it' },
              },
            ],
            ts: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ).toBe(true);
  });

  it('hides while questions are pending', () => {
    expect(
      isPlanAwaitingApproval({
        planMode: true,
        status: 'idle',
        hasPendingQuestions: true,
        messages: [
          {
            role: 'agent',
            text: 'Plan',
            parts: [
              { type: 'tool', id: '1', name: 'ExitPlanMode', status: 'done' },
            ],
            ts: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('latestPlanText', () => {
  it('prefers present_plan content', () => {
    expect(
      latestPlanText([
        { role: 'user', text: 'hi', ts: '1' },
        {
          role: 'agent',
          text: 'short',
          parts: [
            {
              type: 'tool',
              id: '1',
              name: 'present_plan',
              status: 'done',
              input: { content: '# From file' },
            },
          ],
          ts: '2',
        },
      ]),
    ).toBe('# From file');
  });

  it('falls back to newest agent message', () => {
    expect(
      latestPlanText([
        { role: 'user', text: 'hi', ts: '1' },
        { role: 'agent', text: 'plan A', ts: '2' },
        { role: 'agent', text: 'plan B', ts: '3' },
      ]),
    ).toBe('plan B');
  });
});

describe('latestPresentedPlan', () => {
  it('resolves from present_plan', () => {
    const plan = latestPresentedPlan([
      {
        role: 'agent',
        text: 'ok',
        parts: [
          {
            type: 'tool',
            id: '1',
            name: 'present_plan',
            status: 'done',
            input: { title: 'Auth', content: '# Auth plan' },
          },
        ],
        ts: '1',
      },
    ]);
    expect(plan?.title).toBe('Auth');
    expect(plan?.content).toBe('# Auth plan');
  });
});
