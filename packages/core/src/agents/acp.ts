import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOrchestratorThread } from '../store/global-workspace.js';
import type { AgentEvent, AgentStatus, Thread } from '../types/thread.js';
import {
  acpHarnessLabel,
  defaultAcpHarness,
  detectAcpHarness,
  isAcpHarnessId,
  resolveAcpHarnessCommand,
} from './acp-harness.js';
import type { AcpTurnRequest } from './acp-runner.js';
import {
  acpPriorTranscript,
  parseAcpRunnerLine,
  toAcpMcpServers,
} from './acp-protocol.js';
import {
  buildInjectedMcpServers,
  shouldInjectBrightsyMcp,
} from './injected-mcp.js';
import { applyNodeLaunch, resolveNodeLaunch } from './node-launch.js';
import { packagedCursorRuntimeDir } from './packaged-runtime.js';
import { dropCachedPrefixOnResume, flattenTurnInput } from './turn-input.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';

const ACP_ATTACH_ERROR =
  'ACP harnesses have no interactive attach. Continue the chat in Sideboard.';

function entryDir(): string {
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

/** Compiled runner, the packaged cursor-runtime copy, or the TypeScript source in dev. */
export function acpRunnerPath(): string {
  const packagedRoot = packagedCursorRuntimeDir();
  if (packagedRoot) {
    const packaged = join(packagedRoot, 'core-dist', 'agents', 'acp-runner.js');
    if (existsSync(packaged)) return packaged;
  }
  const root = entryDir();
  const candidates = [
    join(root, 'agents', 'acp-runner.js'),
    join(root, 'agents', 'acp-runner.cjs'),
    join(root, 'dist', 'agents', 'acp-runner.js'),
    join(root, 'dist', 'agents', 'acp-runner.cjs'),
    join(root, 'acp-runner.ts'),
    join(root, 'src', 'agents', 'acp-runner.ts'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function harnessFor(thread: Pick<Thread, 'acpHarness'>): ReturnType<typeof defaultAcpHarness> {
  return isAcpHarnessId(thread.acpHarness) ? thread.acpHarness : defaultAcpHarness();
}

export const acpAdapter: AgentAdapter = {
  kind: 'acp',

  async detect(): Promise<AgentStatus> {
    return detectAcpHarness(defaultAcpHarness());
  },

  async buildTurn(thread, input): Promise<TurnCommand> {
    const harness = harnessFor(thread);
    const command = await resolveAcpHarnessCommand(harness);
    const sessionId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const prompt = flattenTurnInput(input);
    const resumePrompt = flattenTurnInput(dropCachedPrefixOnResume(input, sessionId));
    const isOrchestrator = isOrchestratorThread(thread);
    const injected = await buildInjectedMcpServers({
      includeSideboard: true,
      includeBrightsy: shouldInjectBrightsyMcp(thread, { orchestrator: isOrchestrator }),
      orchestratorThreadId: isOrchestrator ? thread.id : null,
      threadId: thread.id,
    });
    const req: AcpTurnRequest = {
      prompt,
      resumePrompt,
      transcript: acpPriorTranscript(thread.messages ?? []),
      cwd: thread.worktreePath,
      sessionId,
      harness,
      command: command.file,
      args: command.args,
      mcpServers: toAcpMcpServers(injected),
      planMode: thread.planMode,
      autonomy: thread.autonomy,
    };
    const runner = acpRunnerPath();
    const isTs = runner.endsWith('.ts');
    const launch = applyNodeLaunch(
      await resolveNodeLaunch(runner),
      isTs ? ['--import', 'tsx', runner] : [runner],
    );
    return {
      file: launch.file,
      args: launch.args,
      cwd: thread.worktreePath,
      stdin: JSON.stringify(req),
      env: launch.env,
    };
  },

  parseEvent(line: string): AgentEvent | null {
    return parseAcpRunnerLine(line);
  },

  async resolveSessionId(_worktreePath, cached): Promise<string | null> {
    return cached?.trim() || null;
  },

  async buildAttach(_thread): Promise<AttachCommand> {
    throw new Error(ACP_ATTACH_ERROR);
  },
};

export function acpHarnessDisplayName(thread: Pick<Thread, 'agent' | 'acpHarness'>): string {
  if (thread.agent !== 'acp') return thread.agent;
  return acpHarnessLabel(thread.acpHarness);
}
