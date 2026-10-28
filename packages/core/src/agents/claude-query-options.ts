import type { ClaudeTurnRequest } from './claude-turn-request.js';

/**
 * Options passed to `query()` from `@anthropic-ai/claude-agent-sdk`.
 *
 * The SDK does not read a top-level `appendSystemPrompt`. Appended text has to
 * live on `systemPrompt: { type: 'preset', preset: 'claude_code', append }`,
 * and omitting `systemPrompt` makes `query()` send an empty system prompt
 * (no Claude Code prompt, no CLAUDE.md). `settingSources: []` also drops
 * CLAUDE.md and user settings; `--strict-mcp-config` is `strictMcpConfig`.
 * Chrome is a boolean CLI flag (`extraArgs.chrome = null`), not `options.chrome`.
 */
export function buildClaudeSdkQueryOptions(
  req: Pick<
    ClaudeTurnRequest,
    | 'cwd'
    | 'claudePath'
    | 'permissionMode'
    | 'allowedTools'
    | 'sessionId'
    | 'model'
    | 'systemPrompt'
    | 'effort'
    | 'chrome'
  >,
  mcpServers: Record<string, unknown>,
  abortController: AbortController,
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    cwd: req.cwd,
    pathToClaudeCodeExecutable: req.claudePath,
    permissionMode: req.permissionMode,
    ...(req.permissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    allowedTools: req.allowedTools,
    mcpServers,
    includePartialMessages: true,
    strictMcpConfig: true,
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      ...(req.systemPrompt ? { append: req.systemPrompt } : {}),
    },
    abortController,
  };
  if (req.sessionId) options.resume = req.sessionId;
  if (req.model) options.model = req.model;
  if (req.effort) options.effort = req.effort;
  if (req.chrome) options.extraArgs = { chrome: null };
  return options;
}
