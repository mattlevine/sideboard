import { describe, expect, it } from 'vitest';
import type { ChatArtifact } from './artifacts';
import {
  applyDetachedJobSnapshot,
  detachedJobId,
  followLogContent,
  jobLogPaths,
  parseExitCode,
} from './job-log-follow';

const running: ChatArtifact = {
  id: 'tool-gha-release',
  title: 'gha-release',
  kind: 'log',
  language: 'log',
  content: '',
  source: 'tool',
  status: 'running',
};

describe('detached job log follow', () => {
  it('reads the job id from a log artifact', () => {
    expect(detachedJobId(running)).toBe('gha-release');
    expect(detachedJobId({ ...running, kind: 'markdown' })).toBeNull();
    expect(jobLogPaths('gha-release').exit).toBe(
      '.context/.sideboard/detached-jobs/gha-release/exit',
    );
  });

  it('fills an empty pane from the log and marks it done when the process exits', () => {
    const shown = applyDetachedJobSnapshot(running, {
      log: 'release-cli completed success\nrelease-desktop-mac completed success\n',
      exitCode: 0,
    });
    expect(shown.content).toContain('release-desktop-mac completed success');
    expect(shown.status).toBe('ok');
  });

  it('keeps a failed exit as failed and does not duplicate a tail already on screen', () => {
    const withLog = applyDetachedJobSnapshot(running, {
      log: 'line 1\nline 2\n',
      exitCode: null,
    });
    const again = applyDetachedJobSnapshot(withLog, {
      log: 'line 1\nline 2\n',
      exitCode: 1,
    });
    expect(again.content).toBe('line 1\nline 2');
    expect(again.status).toBe('failed');
  });

  it('leaves a longer on-screen log in place when the file tail is already inside it', () => {
    expect(followLogContent('older\nline 1\nline 2', 'line 1\nline 2')).toBe(
      'older\nline 1\nline 2',
    );
  });

  it('appends only the new lines when a tail window slides', () => {
    expect(followLogContent('a\nb\nc\nd', 'b\nc\nd\ne')).toBe('a\nb\nc\nd\ne');
    const first = Array.from({ length: 80 }, (_, i) => `L${i}`).join('\n');
    const next = Array.from({ length: 80 }, (_, i) => `L${i + 5}`).join('\n');
    const merged = followLogContent(first, next);
    expect(merged.split('\n')).toHaveLength(85);
    expect(merged.split('\n').filter((line) => line === 'L10')).toHaveLength(1);
    expect(merged.endsWith('L84')).toBe(true);
  });

  it('replaces the pane when the next tail shares no lines', () => {
    expect(followLogContent('old 1\nold 2', 'new 1\nnew 2')).toBe('new 1\nnew 2');
    expect(parseExitCode('0\n')).toBe(0);
    expect(parseExitCode('still going')).toBeNull();
  });
});
