import { describe, expect, it } from 'vitest';
import {
  CLOUD_COORDINATOR_BUSY_REPLY,
  CLOUD_COORDINATOR_TIMEOUT_REPLY,
  CLOUD_ORCHESTRATOR_GOAL,
  SIDEBOARD_FORCE_STOP,
  coordinatorSystemPrompt,
  formatWorkspaceInventory,
  parseForceStopMessage,
} from './cloud-connect.js';

describe('cloud-connect prompts', () => {
  it('re-exports workspace inventory formatter', () => {
    expect(formatWorkspaceInventory([])).toBe('(no registered workspaces)');
    expect(
      formatWorkspaceInventory([
        {
          name: 'sideboard',
          path: '/Users/me/sideboard',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'brightsy-ai',
          path: '/Users/me/brightsy-ai',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    ).toBe(
      [
        '- sideboard: /Users/me/sideboard',
        '- brightsy-ai: /Users/me/brightsy-ai',
      ].join('\n'),
    );
  });

  it('includes all workspaces and no home repo in the coordinator system prompt', () => {
    const prompt = coordinatorSystemPrompt({
      goal: CLOUD_ORCHESTRATOR_GOAL,
      parentId: 'parent-1',
      audience: 'cloud',
      workspaces: [
        {
          name: 'sideboard',
          path: '/Users/me/sideboard',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'storycycle-ai',
          path: '/Users/me/storycycle-ai',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(prompt).toContain('ALL registered workspaces');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toContain('no project git home');
    expect(prompt).toContain('- sideboard: /Users/me/sideboard');
    expect(prompt).toContain('- storycycle-ai: /Users/me/storycycle-ai');
    expect(prompt).not.toContain('Coordinator home repo');
    expect(prompt).not.toContain('Typical flow (existing)');
    expect(prompt).toContain('parent-1');
  });

  it('exports fixed busy and timeout replies for cloud agents', () => {
    expect(CLOUD_COORDINATOR_BUSY_REPLY).toContain('busy');
    expect(CLOUD_COORDINATOR_BUSY_REPLY).toContain('What do you want');
    expect(CLOUD_COORDINATOR_BUSY_REPLY).toContain(SIDEBOARD_FORCE_STOP);
    expect(CLOUD_COORDINATOR_TIMEOUT_REPLY).toContain('timed out');
    expect(CLOUD_COORDINATOR_TIMEOUT_REPLY).toContain(SIDEBOARD_FORCE_STOP);
  });
});

describe('parseForceStopMessage', () => {
  it('parses token-only messages', () => {
    expect(parseForceStopMessage(SIDEBOARD_FORCE_STOP)).toEqual({
      forceStop: true,
      remainder: '',
    });
    expect(parseForceStopMessage(`  ${SIDEBOARD_FORCE_STOP}  `)).toEqual({
      forceStop: true,
      remainder: '',
    });
  });

  it('parses token plus remainder on later lines', () => {
    expect(
      parseForceStopMessage(`${SIDEBOARD_FORCE_STOP}\nretry the deploy`),
    ).toEqual({
      forceStop: true,
      remainder: 'retry the deploy',
    });
    expect(
      parseForceStopMessage(
        `${SIDEBOARD_FORCE_STOP}\n\n  do the thing\nline two  `,
      ),
    ).toEqual({
      forceStop: true,
      remainder: 'do the thing\nline two',
    });
  });

  it('is case-insensitive on the first-line token', () => {
    expect(parseForceStopMessage('sideboard_force_stop')).toEqual({
      forceStop: true,
      remainder: '',
    });
    expect(
      parseForceStopMessage('Sideboard_Force_Stop\ncontinue'),
    ).toEqual({
      forceStop: true,
      remainder: 'continue',
    });
  });

  it('does not treat non-token messages as force-stop', () => {
    expect(parseForceStopMessage('please stop')).toEqual({
      forceStop: false,
      remainder: 'please stop',
    });
    expect(
      parseForceStopMessage(`${SIDEBOARD_FORCE_STOP} please`),
    ).toEqual({
      forceStop: false,
      remainder: `${SIDEBOARD_FORCE_STOP} please`,
    });
    expect(parseForceStopMessage('')).toEqual({
      forceStop: false,
      remainder: '',
    });
  });
});
