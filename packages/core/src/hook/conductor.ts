import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { execa } from 'execa';
import { createInterface } from 'node:readline';

export interface ConductorSettings {
  setup?: string;
  filesToCopy?: string[];
  runScripts: Array<{ name: string; command: string; default?: boolean }>;
}

export function loadConductorSettings(repoPath: string): ConductorSettings | null {
  const path = join(repoPath, '.conductor', 'settings.toml');
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const data = parseToml(raw) as Record<string, unknown>;

  const scripts = (data.scripts ?? {}) as Record<string, unknown>;
  const setup = typeof scripts.setup === 'string' ? scripts.setup : undefined;

  const filesToCopy: string[] = [];
  const files = data.files as { copy?: string[] } | undefined;
  if (Array.isArray(files?.copy)) {
    filesToCopy.push(...files.copy.map(String));
  }
  // Common convention also used by Conductor docs
  const copySection = data['files-to-copy'] as { paths?: string[] } | undefined;
  if (Array.isArray(copySection?.paths)) {
    filesToCopy.push(...copySection.paths.map(String));
  }

  const runScripts: ConductorSettings['runScripts'] = [];
  const run = scripts.run as Record<string, { command?: string; default?: boolean }> | undefined;
  if (run && typeof run === 'object') {
    for (const [name, value] of Object.entries(run)) {
      if (value && typeof value.command === 'string') {
        runScripts.push({
          name,
          command: value.command,
          default: Boolean(value.default),
        });
      }
    }
  }

  return { setup, filesToCopy, runScripts };
}

export function copyConfiguredFiles(repoPath: string, worktreePath: string): string[] {
  const settings = loadConductorSettings(repoPath);
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
): Promise<{ ran: boolean; exitCode: number | null }> {
  const settings = loadConductorSettings(repoPath);
  if (!settings?.setup) return { ran: false, exitCode: null };

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
  return { ran: true, exitCode: result.exitCode ?? null };
}

export function getDefaultRunScript(repoPath: string): { name: string; command: string } | null {
  const settings = loadConductorSettings(repoPath);
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
  const script = getDefaultRunScript(repoPath);
  if (!script) return null;

  const port = await allocatePort();
  const child = execa('bash', ['-lc', script.command], {
    cwd: worktreePath,
    reject: false,
    env: {
      ...process.env,
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

export function hasConductorHook(repoPath: string): boolean {
  return existsSync(join(repoPath, '.conductor', 'settings.toml'));
}
