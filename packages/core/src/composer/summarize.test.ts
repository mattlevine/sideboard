import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../git/run.js';
import {
  CLAUDE_SUMMARY_TIMEOUT_MS,
  extractiveSummary,
  summarizeConversation,
} from './summarize.js';

vi.mock('../git/run.js', () => ({
  run: vi.fn(),
}));

vi.mock('../agents/path.js', () => ({
  ensureAgentPath: vi.fn(),
}));

const runMock = vi.mocked(run);

const HAIKU_SUMMARY = [
  '- Goal: fix the auth redirect',
  '- Files: src/auth.ts',
  '- Open: add regression tests',
].join('\n');

describe('extractiveSummary', () => {
  it('pulls user goals and tool lines from a transcript', () => {
    const transcript = [
      '### User',
      'Fix auth redirect loop',
      '### Agent',
      'Looking at the login flow',
      'Tools:',
      '- Edit: auth.ts (src/auth.ts)',
      '### User',
      'Also add tests',
    ].join('\n');

    const summary = extractiveSummary(transcript);
    expect(summary).toContain('Fix auth redirect loop');
    expect(summary).toContain('Edit: auth.ts');
    expect(summary).toContain('extractive');
  });
});

describe('summarizeConversation', () => {
  beforeEach(() => {
    runMock.mockReset();
  });

  it('times out the Haiku one-shot so Cursor compact cannot wedge spawn', async () => {
    runMock.mockResolvedValue({
      stdout: HAIKU_SUMMARY,
      stderr: '',
      exitCode: 0,
    });

    const result = await summarizeConversation('### User\nFix it', {
      cwd: '/tmp/wt',
    });

    expect(result.method).toBe('claude');
    expect(runMock).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', '--model', 'haiku']),
      expect.objectContaining({
        cwd: '/tmp/wt',
        reject: false,
        timeoutMs: CLAUDE_SUMMARY_TIMEOUT_MS,
      }),
    );
  });

  it('honors an explicit timeoutMs', async () => {
    runMock.mockResolvedValue({ stdout: HAIKU_SUMMARY, stderr: '', exitCode: 0 });
    await summarizeConversation('### User\nFix it', { timeoutMs: 5_000 });
    expect(runMock).toHaveBeenCalledWith(
      'claude',
      expect.any(Array),
      expect.objectContaining({ timeoutMs: 5_000 }),
    );
  });

  it('falls back to extractive when the Haiku CLI times out or fails', async () => {
    runMock.mockResolvedValue({ stdout: '', stderr: 'timed out', exitCode: 1 });
    const result = await summarizeConversation(
      ['### User', 'Fix auth redirect loop', '### Agent', 'Looking at login'].join('\n'),
    );
    expect(result.method).toBe('extractive');
    expect(result.summary).toContain('Fix auth redirect loop');
  });
});
