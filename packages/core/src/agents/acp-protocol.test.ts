import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acpHarnessLooksAuthenticated,
  acpHarnessStatus,
  agentSupportsAttach,
} from './acp-harness.js';
import {
  acpPriorTranscript,
  acpSessionOpenPlan,
  ACP_REPLAY_CHAR_BUDGET,
  buildAcpReplayPrompt,
  parseAcpRunnerLine,
  selectAcpPermissionOption,
  sessionUpdateToEvents,
  toAcpMcpServers,
} from './acp-protocol.js';

describe('ACP session plan', () => {
  it('loads only when the harness says it can and a session id exists', () => {
    expect(acpSessionOpenPlan({ loadSession: true, sessionId: 'sess-1' })).toBe('load');
    expect(acpSessionOpenPlan({ loadSession: false, sessionId: 'sess-1' })).toBe('new');
    expect(acpSessionOpenPlan({ loadSession: true, sessionId: '  ' })).toBe('new');
    expect(acpSessionOpenPlan({ loadSession: true, sessionId: null })).toBe('new');
  });
});

describe('ACP transcript replay', () => {
  it('drops the current user turn and wraps the rest', () => {
    const prior = acpPriorTranscript([
      { role: 'user', text: 'first' },
      { role: 'agent', text: 'did it' },
      { role: 'user', text: 'now do this' },
    ]);
    expect(prior).toEqual([
      { role: 'user', text: 'first' },
      { role: 'agent', text: 'did it' },
    ]);
    const prompt = buildAcpReplayPrompt(prior, 'now do this');
    expect(prompt).toContain('Previous conversation');
    expect(prompt).toContain('User:\nfirst');
    expect(prompt).toContain('Assistant:\ndid it');
    expect(prompt).toContain('Current request:\n\nnow do this');
    expect(prompt).not.toContain('now do this\n\nnow do this');
  });

  it('leaves a first turn unchanged', () => {
    expect(buildAcpReplayPrompt([], 'hello')).toBe('hello');
  });

  it('keeps the newest part of a long transcript', () => {
    const prior = acpPriorTranscript([
      { role: 'user', text: 'old' },
      { role: 'agent', text: 'x'.repeat(ACP_REPLAY_CHAR_BUDGET + 50) },
    ]);
    const prompt = buildAcpReplayPrompt(prior, 'next');
    expect(prompt).toContain('earlier turns omitted');
    expect(prompt.length).toBeLessThan(ACP_REPLAY_CHAR_BUDGET + 400);
  });
});

describe('ACP permissions', () => {
  const options = [
    { optionId: 'always', kind: 'allow_always' },
    { optionId: 'once', kind: 'allow_once' },
    { optionId: 'no', kind: 'reject_once' },
  ];

  it('rejects writes in plan mode and allows reads', () => {
    expect(selectAcpPermissionOption(options, 'plan', 'edit').outcome === 'selected' &&
      selectAcpPermissionOption(options, 'plan', 'edit')).toEqual({
      outcome: 'selected',
      optionId: 'no',
    });
    expect(selectAcpPermissionOption(options, 'plan', 'read')).toEqual({
      outcome: 'selected',
      optionId: 'once',
    });
  });

  it('prefers allow-always when autonomy is full', () => {
    expect(selectAcpPermissionOption(options, 'full', 'execute')).toEqual({
      outcome: 'selected',
      optionId: 'always',
    });
  });

  it('uses allow-once by default', () => {
    expect(selectAcpPermissionOption(options, 'default', 'edit')).toEqual({
      outcome: 'selected',
      optionId: 'once',
    });
  });
});

describe('ACP session updates', () => {
  it('maps message, thought, and a finished tool call', () => {
    expect(
      sessionUpdateToEvents({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' },
        },
      }),
    ).toEqual([{ type: 'stdout', data: 'Hello' }]);
    expect(
      sessionUpdateToEvents({
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'hmm' },
        },
      }),
    ).toEqual([{ type: 'thinking', data: 'hmm' }]);
    expect(
      sessionUpdateToEvents({
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'Read README',
          kind: 'read',
          status: 'completed',
          rawInput: { path: 'README.md' },
          content: [{ type: 'text', text: 'ok' }],
        },
      }),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'call-1',
        name: 'Read README',
        input: { path: 'README.md' },
      },
      { type: 'tool_result', id: 'call-1', content: 'ok', isError: false, partial: false },
    ]);
  });

  it('parses runner event lines and ignores protocol traffic', () => {
    expect(parseAcpRunnerLine('{"type":"stdout","data":"Hi"}')).toEqual({
      type: 'stdout',
      data: 'Hi',
    });
    expect(parseAcpRunnerLine('{"jsonrpc":"2.0","method":"session/update"}')).toBeNull();
    expect(parseAcpRunnerLine('not json')).toBeNull();
  });
});

describe('ACP harness detect', () => {
  it('reports a missing binary without spawning', () => {
    const status = acpHarnessStatus({ id: 'gemini', binPath: null, env: {}, home: '/nowhere' });
    expect(status.agent).toBe('acp');
    expect(status.acpHarness).toBe('gemini');
    expect(status.label).toBe('Gemini CLI');
    expect(status.installed).toBe(false);
    expect(status.authenticated).toBe(false);
    expect(status.reason).toMatch(/gemini/);
  });

  it('treats an API key or a GitHub token file as signed in', () => {
    expect(acpHarnessLooksAuthenticated('gemini', { GEMINI_API_KEY: 'k' }, '/nowhere')).toBe(true);
    expect(acpHarnessLooksAuthenticated('gemini', {}, '/nowhere')).toBe(false);
    const home = mkdtempSync(join(tmpdir(), 'acp-auth-'));
    writeFileSync(join(home, 'hosts.yml'), 'oauth_token: secret\n');
    expect(
      acpHarnessLooksAuthenticated('copilot', {}, home),
    ).toBe(false);
    expect(
      acpHarnessLooksAuthenticated('copilot', {}, join(home, 'missing')),
    ).toBe(false);
    const ghHome = mkdtempSync(join(tmpdir(), 'acp-gh-'));
    mkdirSync(join(ghHome, '.config', 'gh'), { recursive: true });
    writeFileSync(join(ghHome, '.config', 'gh', 'hosts.yml'), 'oauth_token: secret\n');
    expect(acpHarnessLooksAuthenticated('copilot', {}, ghHome)).toBe(true);
  });

  it('hides attach', () => {
    expect(agentSupportsAttach('claude')).toBe(true);
    expect(agentSupportsAttach('acp')).toBe(false);
  });
});

describe('ACP mcp servers', () => {
  it('turns env records into name/value pairs', () => {
    expect(
      toAcpMcpServers([
        { name: 'sideboard', command: 'node', args: ['mcp.js'], env: { SIDEBOARD_THREAD_ID: 't1' } },
      ]),
    ).toEqual([
      {
        name: 'sideboard',
        command: 'node',
        args: ['mcp.js'],
        env: [{ name: 'SIDEBOARD_THREAD_ID', value: 't1' }],
      },
    ]);
  });
});
