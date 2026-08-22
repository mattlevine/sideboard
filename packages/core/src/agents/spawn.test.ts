import { describe, expect, it } from 'vitest';
import {
  applyAgentRunnerHeapEnv,
  applyPromptCacheTtlEnv,
  AGENT_RUNNER_MAX_OLD_SPACE_MB,
  withMaxOldSpaceSize,
} from './spawn.js';
import type { AgentKind } from '../types/thread.js';

describe('applyPromptCacheTtlEnv', () => {
  it('opts Claude and OpenCode into 1h cache TTL', () => {
    const claude: NodeJS.ProcessEnv = {};
    applyPromptCacheTtlEnv('claude', claude);
    expect(claude.ENABLE_PROMPT_CACHING_1H).toBe('1');

    const opencode: NodeJS.ProcessEnv = {};
    applyPromptCacheTtlEnv('opencode', opencode);
    expect(opencode.OPENCODE_ANTHROPIC_PROMPT_CACHING_1H).toBe('1');
  });

  it('does not override an explicit 5m force', () => {
    const claude: NodeJS.ProcessEnv = { FORCE_PROMPT_CACHING_5M: '1' };
    applyPromptCacheTtlEnv('claude', claude);
    expect(claude.ENABLE_PROMPT_CACHING_1H).toBeUndefined();

    const opencode: NodeJS.ProcessEnv = {
      OPENCODE_ANTHROPIC_FORCE_PROMPT_CACHING_5M: '1',
    };
    applyPromptCacheTtlEnv('opencode', opencode);
    expect(opencode.OPENCODE_ANTHROPIC_PROMPT_CACHING_1H).toBeUndefined();
  });

  it('leaves Codex / Cursor / Brightsy env unchanged', () => {
    const env: NodeJS.ProcessEnv = {};
    applyPromptCacheTtlEnv('codex', env);
    applyPromptCacheTtlEnv('cursor', env);
    applyPromptCacheTtlEnv('brightsy', env);
    expect(env.ENABLE_PROMPT_CACHING_1H).toBeUndefined();
    expect(env.OPENCODE_ANTHROPIC_PROMPT_CACHING_1H).toBeUndefined();
  });
});

describe('withMaxOldSpaceSize', () => {
  it('adds the flag when NODE_OPTIONS is empty', () => {
    expect(withMaxOldSpaceSize(undefined, 8192)).toBe('--max-old-space-size=8192');
    expect(withMaxOldSpaceSize('', 8192)).toBe('--max-old-space-size=8192');
  });

  it('appends next to existing flags', () => {
    expect(withMaxOldSpaceSize('--enable-source-maps', 8192)).toBe(
      '--enable-source-maps --max-old-space-size=8192',
    );
  });

  it('bumps a smaller heap and keeps a larger one', () => {
    expect(withMaxOldSpaceSize('--max-old-space-size=4096', 8192)).toBe(
      '--max-old-space-size=8192',
    );
    expect(withMaxOldSpaceSize('--max-old-space-size=16384', 8192)).toBe(
      '--max-old-space-size=16384',
    );
    expect(withMaxOldSpaceSize('--max_old_space_size=2048 --trace-gc', 8192)).toBe(
      '--max-old-space-size=8192 --trace-gc',
    );
  });
});

describe('applyAgentRunnerHeapEnv', () => {
  it('raises NODE_OPTIONS for every agent', () => {
    const agents: AgentKind[] = ['claude', 'codex', 'opencode', 'brightsy', 'cursor'];
    for (const agent of agents) {
      const env: NodeJS.ProcessEnv = {};
      applyAgentRunnerHeapEnv(env);
      expect(env.NODE_OPTIONS, agent).toBe(
        `--max-old-space-size=${AGENT_RUNNER_MAX_OLD_SPACE_MB}`,
      );
    }
  });
});
