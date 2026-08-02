/**
 * Turn payload for agent CLIs.
 * `cachedPrefix` is stable context (instructions, conversation seed) sent before
 * the varying current request. Claude Code injects Anthropic cache_control on the
 * assembled API request (system + tools + messages, max 4). Sideboard must not use
 * `--input-format stream-json` for user input or attach cache_control — either
 * adds a fifth breakpoint and triggers API 400 "Found 5".
 */
export interface AgentTurnInput {
  /** Stable prefix — instructions / session seed (cacheable, but no cache_control). */
  cachedPrefix?: string;
  /** Current user/turn content (after the stable prefix). */
  prompt: string;
}

export function normalizeTurnInput(
  input: string | AgentTurnInput,
): Required<Pick<AgentTurnInput, 'prompt'>> & AgentTurnInput {
  if (typeof input === 'string') return { prompt: input };
  return { prompt: input.prompt, cachedPrefix: input.cachedPrefix?.trim() || undefined };
}

/**
 * Flatten to a single string for CLIs that don't accept cache_control blocks
 * (Codex today; OpenCode `run` is plain text — OpenCode applies provider caching
 * internally after it receives the message).
 */
export function flattenTurnInput(input: string | AgentTurnInput): string {
  const { cachedPrefix, prompt } = normalizeTurnInput(input);
  if (!cachedPrefix) return prompt;
  return `${cachedPrefix}\n\n---\n\nCurrent request:\n${prompt}`;
}

/** Anthropic cache breakpoint shape (used when validating assembled requests). */
export type AnthropicCacheControl = {
  type: 'ephemeral';
  ttl?: '5m' | '1h';
};

/**
 * Anthropic content blocks for Claude stream-json user messages (legacy/tests).
 * Production Claude turns use plain-text `-p` — see claudeAdapter.buildTurn.
 * Always a single text block — never attach cache_control here.
 */
export function buildCachedUserContent(input: string | AgentTurnInput): Array<{
  type: 'text';
  text: string;
}> {
  return [{ type: 'text', text: flattenTurnInput(input) }];
}

/** NDJSON stdin line for `claude -p --input-format stream-json`. */
export function buildClaudeStreamJsonUserMessage(input: string | AgentTurnInput): string {
  return `${JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: buildCachedUserContent(input),
    },
  })}\n`;
}

type CacheControlCarrier = { cache_control?: AnthropicCacheControl; content?: unknown };

type CacheControlWalk = {
  saw5m: boolean;
  invalid: { index: number; ttl: '1h' } | null;
};

function walkCacheControls(
  blocks: CacheControlCarrier[] | undefined,
  saw5m: boolean,
): CacheControlWalk {
  if (!blocks?.length) return { saw5m, invalid: null };
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const ttl = block.cache_control?.ttl ?? (block.cache_control ? '5m' : null);
    if (ttl === '5m') saw5m = true;
    if (ttl === '1h' && saw5m) return { saw5m, invalid: { index: i, ttl: '1h' } };
    if (Array.isArray(block.content)) {
      const nested = walkCacheControls(block.content as CacheControlCarrier[], saw5m);
      if (nested.invalid) return { saw5m: nested.saw5m, invalid: { index: i, ttl: '1h' } };
      saw5m = nested.saw5m;
    }
  }
  return { saw5m, invalid: null };
}

/**
 * Walk nested Anthropic content blocks and verify 1h breakpoints never follow 5m
 * ones (Anthropic rejects requests that violate this ordering).
 */
export function findInvalidCacheControlTtlOrder(
  blocks: CacheControlCarrier[] | undefined,
): { index: number; ttl: '1h' | '5m' } | null {
  return walkCacheControls(blocks, false).invalid;
}

/** Count cache_control blocks in nested Anthropic content (API max is 4). */
export function countCacheControlBlocks(blocks: CacheControlCarrier[] | undefined): number {
  if (!blocks?.length) return 0;
  let count = 0;
  for (const block of blocks) {
    if (block.cache_control) count++;
    if (Array.isArray(block.content)) {
      count += countCacheControlBlocks(block.content as CacheControlCarrier[]);
    }
  }
  return count;
}

/** Anthropic allows at most four cache_control blocks per request. */
export const MAX_ANTHROPIC_CACHE_CONTROL_BLOCKS = 4;
