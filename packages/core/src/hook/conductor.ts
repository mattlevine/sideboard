import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import { createInterface } from 'node:readline';
import {
  hasConductorHook,
  hasRepoHook,
  hasWorkspaceHook,
  loadConductorSettings,
  loadRepoSettings,
  loadWorkspaceSettings,
  settingsSourceLabel,
  workspaceSettingsSourceLabel,
  type RepoSettings,
} from './settings.js';

export type { RepoSettings };
export type ConductorSettings = RepoSettings;
export {
  hasConductorHook,
  hasRepoHook,
  hasWorkspaceHook,
  loadConductorSettings,
  loadRepoSettings,
  loadWorkspaceSettings,
  settingsSourceLabel,
  workspaceSettingsSourceLabel,
};

export function copyConfiguredFiles(repoPath: string, worktreePath: string): string[] {
  const settings = loadRepoSettings(repoPath);
  if (!settings?.filesToCopy?.length) {
    // Sensible default for common local env files
    const defaults = ['.env.local', '.env'];
    const copied: string[] = [];
    for (const rel of defaults) {
      const src = join(repoPath, rel);
      if (!existsSync(src)) continue;
      const dest = join(worktreePath, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      copied.push(rel);
    }
    return copied;
  }

  const copied: string[] = [];
  for (const rel of settings.filesToCopy) {
    const src = join(repoPath, rel);
    if (!existsSync(src)) continue;
    const dest = join(worktreePath, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    copied.push(rel);
  }
  return copied;
}

export async function runSetupScript(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
): Promise<{ ran: boolean; exitCode: number | null; source: string | null }> {
  const settings = loadWorkspaceSettings(worktreePath, repoPath);
  if (!settings?.setup) return { ran: false, exitCode: null, source: null };

  const child = execa('bash', ['-lc', settings.setup], {
    cwd: worktreePath,
    reject: false,
    env: { ...process.env },
  });

  const pipe = (stream: NodeJS.ReadableStream | null) => {
    if (!stream || !onLine) return;
    const rl = createInterface({ input: stream });
    rl.on('line', onLine);
  };
  pipe(child.stdout);
  pipe(child.stderr);

  const result = await child;
  return {
    ran: true,
    exitCode: result.exitCode ?? null,
    source: workspaceSettingsSourceLabel(worktreePath, repoPath),
  };
}

export function getDefaultRunScript(
  worktreePath: string,
  repoPath?: string | null,
): { name: string; command: string } | null {
  const settings = loadWorkspaceSettings(worktreePath, repoPath);
  if (!settings?.runScripts.length) return null;
  return (
    settings.runScripts.find((s) => s.default) ??
    settings.runScripts.find((s) => s.name === 'dev') ??
    settings.runScripts[0] ??
    null
  );
}

export async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to allocate port'));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

export interface DevServerHandle {
  pid: number | undefined;
  port: number;
  kill: () => void;
  done: Promise<number | null>;
}

export async function startDevServer(
  repoPath: string,
  worktreePath: string,
  onLine?: (line: string) => void,
): Promise<DevServerHandle | null> {
  const script = getDefaultRunScript(worktreePath, repoPath);
  if (!script) return null;

  const port = await allocatePort();
  const child = execa('bash', ['-lc', script.command], {
    cwd: worktreePath,
    reject: false,
    env: {
      ...process.env,
      // Both names — Conductor-compatible repos keep working; Sideboard-native preferred.
      SIDEBOARD_PORT: String(port),
      CONDUCTOR_PORT: String(port),
      PORT: String(port),
    },
  });

  const pipe = (stream: NodeJS.ReadableStream | null) => {
    if (!stream || !onLine) return;
    const rl = createInterface({ input: stream });
    rl.on('line', onLine);
  };
  pipe(child.stdout);
  pipe(child.stderr);

  return {
    pid: child.pid,
    port,
    kill: () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    },
    done: child.then((r) => r.exitCode ?? null),
  };
}
