import { describe, expect, it } from 'vitest';
import { applyPromptCacheTtlEnv } from './spawn.js';

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
