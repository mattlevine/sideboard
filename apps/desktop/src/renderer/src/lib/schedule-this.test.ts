import { describe, expect, it } from 'vitest';
import { formFromScheduleThis } from '../components/automation-form';
import {
  SCHEDULE_THIS_EVERY,
  scheduleThisPrompt,
  scheduleThisThreadId,
  suggestedScheduleTime,
} from './schedule-this';

describe('scheduleThisPrompt', () => {
  const messages = [
    { role: 'user', text: 'First ask' },
    { role: 'agent', text: 'Done' },
    { role: 'user', text: '  Check CI again  ' },
  ];

  it('uses selected text when it is present', () => {
    expect(scheduleThisPrompt({ selectedText: ' this paragraph ', messages })).toBe(
      'this paragraph',
    );
  });

  it('uses the latest user prompt when nothing is selected', () => {
    expect(scheduleThisPrompt({ selectedText: '   ', messages })).toBe('Check CI again');
    expect(scheduleThisPrompt({ messages: [{ role: 'agent', text: 'hi' }] })).toBeNull();
  });
});

describe('scheduleThisThreadId', () => {
  it('omits the chat for Global and orchestration', () => {
    expect(
      scheduleThisThreadId({
        id: 'orch',
        sourceType: 'orchestration',
        repoPath: '/tmp/repo',
      }),
    ).toBe('');
    expect(
      scheduleThisThreadId({
        id: 'global',
        sourceType: 'branch',
        repoPath: '__global__',
      }),
    ).toBe('');
  });

  it('continues a worktree chat', () => {
    expect(
      scheduleThisThreadId({
        id: 'wt-1',
        sourceType: 'branch',
        repoPath: '/tmp/repo',
      }),
    ).toBe('wt-1');
  });
});

describe('suggestedScheduleTime', () => {
  it('rounds up to the next half-hour', () => {
    expect(suggestedScheduleTime(new Date(2026, 7, 21, 15, 10, 0))).toBe('15:30');
    expect(suggestedScheduleTime(new Date(2026, 7, 21, 15, 30, 0))).toBe('16:00');
    expect(suggestedScheduleTime(new Date(2026, 7, 21, 23, 50, 0))).toBe('00:00');
  });
});

describe('formFromScheduleThis', () => {
  it('prefills a daily automation and the suggested clock time', () => {
    const form = formFromScheduleThis({
      prompt: 'Triage open PRs',
      threadId: 'wt-1',
      every: SCHEDULE_THIS_EVERY,
      time: '09:30',
      agent: 'cursor',
      model: 'composer',
      effort: 'high',
      fast: true,
      planMode: false,
      autonomy: 'full',
    });
    expect(form.prompt).toBe('Triage open PRs');
    expect(form.kind).toBe('every');
    expect(form.every).toBe('1d');
    expect(form.time).toBe('09:30');
    expect(form.days).toEqual([1, 2, 3, 4, 5]);
    expect(form.threadId).toBe('wt-1');
    expect(form.agent).toBe('cursor');
    expect(form.model).toBe('composer');
    expect(form.fast).toBe(true);
    expect(form.archiveChat).toBe(true);
  });
});
