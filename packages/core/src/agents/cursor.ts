import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cursor } from '@cursor/sdk';
import { run } from '../git/run.js';
import { loadAppSettings } from '../store/app-settings.js';
import type { AgentEvent, AgentStatus } from '../types/thread.js';
import {
  parseCursorRunnerLine,
  type CursorTurnRequest,
} from './cursor-events.js';
import type { AgentModelInfo } from './model-info.js';
import { resolveNodeLaunch } from './node-launch.js';
import { flattenTurnInput } from './turn-input.js';
import type { AgentAdapter, AttachCommand, TurnCommand } from './types.js';

export type { AgentModelInfo, CursorModelInfo } from './model-info.js';

const FALLBACK_CURSOR_MODELS: AgentModelInfo[] = [
  { id: 'default', displayName: 'Auto' },
  { id: 'composer-2.5', displayName: 'Composer 2.5' },
  { id: 'composer-2', displayName: 'Composer 2' },
];

let cachedModels: { at: number; models: AgentModelInfo[] } | null = null;
const MODEL_CACHE_MS = 5 * 60 * 1000;

function resolveCursorApiKey(): string {
  const fromEnv = (process.env.CURSOR_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  return (loadAppSettings().environment.CURSOR_API_KEY || '').trim();
}

/** True when the thread uses Cursor Auto (`default` / null / `auto`). */
export function isCursorAutoModel(model: string | null | undefined): boolean {
  const id = (model ?? '').trim().toLowerCase();
  return !id || id === 'default' || id === 'auto';
}

/** Resolve SDK model id for a turn (null → Auto). */
export function resolveCursorModelId(model: string | null | undefined): string {
  if (isCursorAutoModel(model)) return 'default';
  return model!.trim();
}

/**
 * List models available to the configured CURSOR_API_KEY.
 * Cached briefly; falls back to a small static list when unauthenticated / offline.
 */
export async function listCursorModels(): Promise<AgentModelInfo[]> {
  const now = Date.now();
  if (cachedModels && now - cachedModels.at < MODEL_CACHE_MS) {
    return cachedModels.models;
  }

  const apiKey = resolveCursorApiKey();
  if (!apiKey) return FALLBACK_CURSOR_MODELS;

  try {
    const listed = await Cursor.models.list({ apiKey });
    const models: AgentModelInfo[] = listed
      .map((m) => ({
        id: m.id,
        displayName: m.displayName || m.id,
        description: m.description,
      }))
      .filter((m) => Boolean(m.id));
    if (models.length === 0) return FALLBACK_CURSOR_MODELS;
    cachedModels = { at: now, models };
    return models;
  } catch {
    return cachedModels?.models ?? FALLBACK_CURSOR_MODELS;
  }
}

export {
  cursorSdkMessageToEvents,
  parseCursorRunnerLine,
} from './cursor-events.js';
export type { CursorSdkStreamMessage, CursorTurnRequest } from './cursor-events.js';

function entryDir(): string {
  // CJS bundle (Electron main) has __dirname = dist/
  // eslint-disable-next-line camelcase
  const cjsDir = typeof __dirname !== 'undefined' ? __dirname : '';
  if (cjsDir) return cjsDir;
  try {
    // ESM bundle: import.meta.url points at dist/index.js
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    // Last resort: resolve the package entry and use its directory.
    try {
      const req = createRequire(process.cwd() + '/');
      return dirname(req.resolve('@sideboard-ai/core'));
    } catch {
      return process.cwd();
    }
  }
}

/** Resolve the compiled Cursor SDK runner (tsup emits dist/agents/cursor-runner.*). */
export function cursorRunnerPath(): string {
  const root = entryDir();
  const candidates = [
    join(root, 'agents', 'cursor-runner.js'),
    join(root, 'agents', 'cursor-runner.cjs'),
    // If somehow resolved from package root instead of dist/
    join(root, 'dist', 'agents', 'cursor-runner.js'),
    join(root, 'dist', 'agents', 'cursor-runner.cjs'),
    // Source tree (dev): packages/core/src/agents/cursor-runner.ts
    join(root, 'cursor-runner.ts'),
    join(root, 'src', 'agents', 'cursor-runner.ts'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export const cursorAdapter: AgentAdapter = {
  kind: 'cursor',

  async detect(): Promise<AgentStatus> {
    const apiKey = resolveCursorApiKey();
    if (!apiKey) {
      return {
        agent: 'cursor',
        installed: true,
        authenticated: false,
        linearMcp: false,
        warnings: [],
        reason:
          'CURSOR_API_KEY not set — add it in Settings → Agents → Cursor, or Settings → Environment',
      };
    }

    try {
      await Cursor.models.list({ apiKey });
      return {
        agent: 'cursor',
        installed: true,
        authenticated: true,
        linearMcp: false,
        warnings: [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        agent: 'cursor',
        installed: true,
        authenticated: false,
        linearMcp: false,
        warnings: [],
        reason: `Cursor API auth failed: ${message}`,
      };
    }
  },

  async buildTurn(thread, input): Promise<TurnCommand> {
    const prompt = flattenTurnInput(input);
    const agentId = await this.resolveSessionId(thread.worktreePath, thread.sessionId);
    const apiKey = resolveCursorApiKey() || undefined;
    const req: CursorTurnRequest = {
      prompt,
      cwd: thread.worktreePath,
      agentId,
      model: thread.model,
      fast: thread.fast,
      planMode: thread.planMode,
      apiKey,
    };

    const runner = cursorRunnerPath();
    const isTs = runner.endsWith('.ts');
    // Prefer a real Node on PATH when the runner is on a normal filesystem.
    // Scripts inside Electron's app.asar are invisible to system Node
    // (MODULE_NOT_FOUND) — use ELECTRON_RUN_AS_NODE in that case. The runner
    // uses JsonlLocalAgentStore so Electron's Node (no node:sqlite) is fine.
    const launch = await resolveNodeLaunch(runner);
    return {
      file: launch.file,
      args: isTs ? ['--import', 'tsx', runner] : [runner],
      cwd: thread.worktreePath,
      stdin: JSON.stringify(req),
      env: {
        ...launch.env,
        ...(apiKey ? { CURSOR_API_KEY: apiKey } : {}),
      },
    };
  },

  parseEvent(line: string): AgentEvent | AgentEvent[] | null {
    return parseCursorRunnerLine(line);
  },

  async resolveSessionId(_worktreePath, cached): Promise<string | null> {
    return cached;
  },

  async buildAttach(thread): Promise<AttachCommand> {
    const which = await run('which', ['cursor'], { reject: false });
    if (which.exitCode === 0) {
      return { file: 'cursor', args: [thread.worktreePath], cwd: thread.worktreePath };
    }
    throw new Error(
      'Cursor agents have no interactive CLI attach. Install the Cursor shell command (`cursor`) to open the worktree, or continue the thread in Sideboard.',
    );
  },
};
