import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_RPC_CLAUDE_SDK_SERVER } from '../agent-rpc/protocol.js';
import { PILOT_TOOL_NAMES } from '../agent-rpc/pilot-tools.js';
import { applyNodeLaunch, resolveNodeLaunch } from './node-launch.js';
import { packagedCursorRuntimeDir } from './packaged-runtime.js';
import type { ClaudeTurnRequest } from './claude-turn-request.js';
import type { TurnCommand } from './types.js';

export function claudePilotSdkAllowedTools(): string[] {
  return PILOT_TOOL_NAMES.map(
    (name) => `mcp__${AGENT_RPC_CLAUDE_SDK_SERVER}__${name}`,
  );
}

export function withClaudePilotRpcTools(allowed: string[]): string[] {
  const omit = new Set(PILOT_TOOL_NAMES.map((name) => `mcp__sideboard__${name}`));
  return [...allowed.filter((name) => !omit.has(name)), ...claudePilotSdkAllowedTools()];
}

function entryDir(): string {
  // Match cursor.ts: Electron main is CJS (`dist/index.cjs`). `import.meta.url`
  // is missing there, and `process.cwd()` is `apps/desktop` — never a runner.
  // eslint-disable-next-line camelcase
  const cjsDir = typeof __dirname !== 'undefined' ? __dirname : '';
  if (cjsDir) return cjsDir;
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    try {
      const req = createRequire(process.cwd() + '/');
      return dirname(req.resolve('@sideboard-ai/core'));
    } catch {
      return process.cwd();
    }
  }
}

/** Resolve the compiled Claude SDK runner (tsup emits dist/agents/claude-runner.*). */
export function claudeRunnerPath(): string {
  const packagedDir = packagedCursorRuntimeDir();
  if (packagedDir) {
    const packaged = join(packagedDir, 'core-dist', 'agents', 'claude-runner.js');
    if (existsSync(packaged)) return packaged;
  }
  const root = entryDir();
  const candidates = [
    join(root, 'agents', 'claude-runner.js'),
    join(root, 'agents', 'claude-runner.cjs'),
    join(root, 'dist', 'agents', 'claude-runner.js'),
    join(root, 'dist', 'agents', 'claude-runner.cjs'),
    join(root, 'claude-runner.ts'),
    join(root, 'src', 'agents', 'claude-runner.ts'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export async function buildClaudeRpcTurnCommand(
  req: ClaudeTurnRequest,
): Promise<TurnCommand> {
  const runner = claudeRunnerPath();
  const isTs = runner.endsWith('.ts');
  const launch = applyNodeLaunch(
    await resolveNodeLaunch(runner),
    isTs ? ['--import', 'tsx', runner] : [runner],
  );
  return {
    file: launch.file,
    args: launch.args,
    cwd: req.cwd,
    stdin: JSON.stringify(req),
    env: {
      ...launch.env,
      CLAUDE_CODE_FORWARD_SUBAGENT_TEXT: '1',
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS:
        process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? '7200000',
      ...(req.isolateClaudeAiMcp ? { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } : {}),
    },
  };
}
