import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./run.js', () => ({
  git: vi.fn(),
  gh: vi.fn(),
  run: vi.fn(),
}));

import { gh, git } from './run.js';
import {
  createOrUpdatePr,
  ghHeadRef,
  ghRepoSelectArgs,
  parseGithubSlugFromRemoteUrl,
} from './worktree.js';

const ghMock = vi.mocked(gh);
const gitMock = vi.mocked(git);

afterEach(() => {
  ghMock.mockReset();
  gitMock.mockReset();
});

describe('parseGithubSlugFromRemoteUrl', () => {
  it('parses SSH host aliases', () => {
    expect(
      parseGithubSlugFromRemoteUrl('git@github.com-work:mattlevine/storycycle-ai.git'),
    ).toBe('mattlevine/storycycle-ai');
  });
});

describe('ghHeadRef / ghRepoSelectArgs', () => {
  it('builds -R and owner:branch', () => {
    expect(ghRepoSelectArgs('acme/widgets')).toEqual(['-R', 'acme/widgets']);
    expect(ghHeadRef('acme/widgets', 'thread/paris')).toBe('acme:thread/paris');
    expect(ghHeadRef('acme/widgets', 'acme:already')).toBe('acme:already');
  });
});

describe('createOrUpdatePr', () => {
  it('creates with -R origin and owner:branch head (never bare gh)', async () => {
    gitMock.mockImplementation(async (args) => {
      if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin') {
        return {
          stdout: 'git@github.com:mattlevine/storycycle-ai.git',
          stderr: '',
          exitCode: 0,
        };
      }
      if (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'upstream') {
        return {
          stdout: 'git@github.com:makerkit/next-supabase-saas-kit-turbo.git',
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    });

    ghMock.mockImplementation(async (args) => {
      // set-default / prefer-origin probes
      if (args[0] === 'repo' && args[1] === 'set-default') {
        return { stdout: 'mattlevine/storycycle-ai', stderr: '', exitCode: 0 };
      }
      // existing PR lookup
      if (args.includes('pr') && args.includes('view')) {
        return { stdout: '', stderr: 'not found', exitCode: 1 };
      }
      if (args.includes('pr') && args.includes('create')) {
        return {
          stdout: 'https://github.com/mattlevine/storycycle-ai/pull/99\n',
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const url = await createOrUpdatePr('/tmp/wt', {
      title: 'Fix advisories',
      body: 'body',
      base: 'main',
      head: 'fix/nextjs-mcp-sdk-advisories',
    });

    expect(url).toContain('pull/99');
    const createCall = ghMock.mock.calls.find((c) =>
      c[0].includes('create'),
    );
    expect(createCall?.[0]).toEqual([
      '-R',
      'mattlevine/storycycle-ai',
      'pr',
      'create',
      '--title',
      'Fix advisories',
      '--body',
      'body',
      '--base',
      'main',
      '--head',
      'mattlevine:fix/nextjs-mcp-sdk-advisories',
    ]);
  });
});
