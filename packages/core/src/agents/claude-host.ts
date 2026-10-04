import { existsSync } from 'node:fs';
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
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

export function claudeRunnerPath(): string {
  const packagedDir = packagedCursorRuntimeDir();
  if (packagedDir) {
    const packaged = join(packagedDir, 'core-dist', 'agents', 'claude-runner.js');
    if (existsSync(packaged)) return packaged;
  }
  const root = entryDir();
  const candidates = [
    join(root, 'claude-runner.js'),
    join(root, 'claude-runner.cjs'),
    join(root, 'dist', 'agents', 'claude-runner.js'),
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
