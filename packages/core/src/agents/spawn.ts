import { createInterface } from 'node:readline';
import { execa } from 'execa';
import type { AgentEvent, Thread } from '../types/thread.js';
import { getAdapter } from './index.js';

export interface SpawnTurnHandle {
  pid: number | undefined;
  kill: () => void;
  done: Promise<{ exitCode: number | null; sessionId: string | null; assistantText: string }>;
}

export async function spawnAgentTurn(
  thread: Thread,
  prompt: string,
  onEvent: (event: AgentEvent) => void,
): Promise<SpawnTurnHandle> {
  const adapter = getAdapter(thread.agent);
  const cmd = await adapter.buildTurn(thread, prompt);

  const child = execa(cmd.file, cmd.args, {
    cwd: cmd.cwd,
    env: { ...process.env, ...cmd.env },
    reject: false,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let sessionId: string | null = thread.sessionId;
  let assistantText = '';

  const consume = (stream: NodeJS.ReadableStream | null, kind: 'stdout' | 'stderr') => {
    if (!stream) return;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (kind === 'stderr') {
        onEvent({ type: 'stderr', data: line });
        return;
      }
      const parsed = adapter.parseEvent(line);
      if (!parsed) return;
      if (parsed.type === 'session_id') {
        sessionId = parsed.data;
      }
      if (parsed.type === 'stdout') {
        assistantText += parsed.data;
      }
      onEvent(parsed);
    });
  };

  consume(child.stdout, 'stdout');
  consume(child.stderr, 'stderr');

  const done = child.then((result) => {
    const exitCode = result.exitCode ?? null;
    onEvent({ type: 'exit', data: exitCode });
    return { exitCode, sessionId, assistantText };
  });

  return {
    pid: child.pid,
    kill: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
    done,
  };
}
