import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceScriptEnv,
  copyConfiguredFiles,
  getRunMode,
  isOtherWorktreeListenerCwd,
  killableListenerPids,
  killListenersOnPorts,
  listRunScripts,
  reservePort,
  reservePortRange,
  resolveFilesToCopy,
  runConventionSetup,
  runWorkspaceSetup,
  startDevServer,
  stripNestedElectronEnv,
} from './conductor.js';
import { loadWorktreeRunPorts } from './worktree-run-ports.js';
import { CONTEXT_REVIEW_PATH, REPO_REVIEW_PATH, REVIEW_SKILL_PATH } from '../review/request-review.js';

describe('resolveFilesToCopy', () => {
  it('prefers .worktreeinclude over settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-include-'));
    writeFileSync(join(root, '.worktreeinclude'), '.env*\n.brightsy.json\n# comment\n');
    mkdirSync(join(root, '.sideboard'));
    writeFileSync(
      join(root, '.sideboard', 'settings.toml'),
      `[files]\ncopy = [".env"]\n`,
    );
    expect(resolveFilesToCopy(root)).toEqual(['.env*', '.brightsy.json']);
  });

  it('copies matching files from .worktreeinclude', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-copy-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-wt-'));
    writeFileSync(join(root, '.env'), 'A=1\n');
    writeFileSync(join(root, '.brightsy.json'), '{}\n');
    writeFileSync(join(root, '.worktreeinclude'), '.env\n.brightsy.json\n');
    const copied = copyConfiguredFiles(root, wt);
    expect(copied).toEqual(['.env', '.brightsy.json']);
    expect(resolveFilesToCopy(root)).toEqual(['.env', '.brightsy.json']);
  });
});

describe('listRunScripts / runMode', () => {
  it('filters available_in and reads run_mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'sideboard-run-'));
    mkdirSync(join(root, '.sideboard'));
    writeFileSync(
      join(root, '.sideboard', 'settings.toml'),
      `
[scripts]
run_mode = "nonconcurrent"

[scripts.run.dev]
command = "pnpm dev"
default = true
available_in = [ "local" ]

[scripts.run.cloud]
command = "echo cloud"
available_in = [ "cloud" ]
`,
    );
    expect(getRunMode(root)).toBe('nonconcurrent');
    const scripts = listRunScripts(root);
    expect(scripts.map((s) => s.name)).toEqual(['dev']);
  });
});

describe('buildWorkspaceScriptEnv', () => {
  it('sets Sideboard and Conductor aliases', () => {
    const env = buildWorkspaceScriptEnv(
      {
        worktreePath: '/tmp/ws/ajax',
        repoPath: '/tmp/repo',
        workspaceName: 'ajax',
        defaultBranch: 'main',
        ports: [4000, 4001, 4002],
      },
      {},
    );
    expect(env.SIDEBOARD_PORT).toBe('4000');
    expect(env.CONDUCTOR_PORT).toBe('4000');
    expect(env.PORT).toBe('4000');
    expect(env.SIDEBOARD_PORT_1).toBe('4001');
    expect(env.CONDUCTOR_PORT_1).toBe('4001');
    expect(env.SIDEBOARD_WORKSPACE_NAME).toBe('ajax');
    expect(env.CONDUCTOR_ROOT_PATH).toBe('/tmp/repo');
    expect(env.SIDEBOARD_DEFAULT_BRANCH).toBe('main');
    expect(env.SIDEBOARD_IS_LOCAL).toBe('1');
    expect(env.npm_config_store_dir).toBe(
      '/tmp/ws/ajax/.context/.sideboard/pkg-cache/pnpm-store',
    );
    expect(env.npm_config_devdir).toBe(
      '/tmp/ws/ajax/.context/.sideboard/pkg-cache/node-gyp',
    );
    expect(env.ELECTRON_CACHE).toBeUndefined();
  });

  it('strips inherited Electron/Chromium env so nested electron-vite can start', () => {
    const env = buildWorkspaceScriptEnv(
      {
        worktreePath: '/tmp/ws/ajax',
        repoPath: '/tmp/repo',
        ports: [5173],
      },
      {
        PATH: '/usr/bin',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_RENDERER_URL: 'http://localhost:5173',
        CHROME_CRASHPAD_PIPE_NAME: 'crashpad_123',
        SIDEBOARD_WORKSPACE_NAME: 'stale',
      },
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.ELECTRON_RENDERER_URL).toBeUndefined();
    expect(env.CHROME_CRASHPAD_PIPE_NAME).toBeUndefined();
    expect(env.SIDEBOARD_WORKSPACE_NAME).toBe('ajax');
    expect(env.PORT).toBe('5173');
  });
});

describe('stripNestedElectronEnv', () => {
  it('copies the env and drops only Electron/Chrome keys', () => {
    expect(
      stripNestedElectronEnv({
        HOME: '/Users/me',
        ELECTRON_NO_ASAR: '1',
        CHROME_DESKTOP: 'Sideboard.desktop',
      }),
    ).toEqual({ HOME: '/Users/me' });
  });
});

describe('runConventionSetup / runWorkspaceSetup', () => {
  it('runs script/setup in the worktree', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-run-conv-'));
    mkdirSync(join(wt, 'script'));
    writeFileSync(join(wt, 'script', 'setup'), '#!/bin/bash\necho ran-setup\n');
    const lines: string[] = [];
    const result = await runConventionSetup(wt, wt, (l) => lines.push(l));
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.source).toBe('script/setup (worktree)');
    expect(lines.join('\n')).toContain('ran-setup');
  });

  it('runs main-repo settings.toml setup when the worktree only has run scripts', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sideboard-setup-repo-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-setup-wt-'));
    mkdirSync(join(repo, '.sideboard'));
    mkdirSync(join(wt, '.conductor'));
    writeFileSync(
      join(repo, '.sideboard', 'settings.toml'),
      `[scripts]\nsetup = "echo inherited-setup"\n`,
    );
    writeFileSync(
      join(wt, '.conductor', 'settings.toml'),
      `[scripts.run.dev]\ncommand = "echo dev"\n`,
    );
    const lines: string[] = [];
    const result = await runWorkspaceSetup(repo, wt, (l) => lines.push(l));
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('inherited-setup');
  });

  it('prefers settings.toml setup over a conventional script', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-run-ws-'));
    mkdirSync(join(wt, 'script'));
    mkdirSync(join(wt, '.sideboard'));
    writeFileSync(join(wt, 'script', 'setup'), '#!/bin/bash\necho from-convention\n');
    writeFileSync(
      join(wt, '.sideboard', 'settings.toml'),
      `[scripts]\nsetup = "echo from-toml"\n`,
    );
    const lines: string[] = [];
    const result = await runWorkspaceSetup(wt, wt, (l) => lines.push(l));
    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.source).toContain('settings.toml');
    expect(lines.join('\n')).toContain('[setup]');
    expect(lines.join('\n')).toContain('from-toml');
    expect(lines.join('\n')).not.toContain('from-convention');
  });

  it('copies review guidelines into .context/review.md when no review skill exists', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-review-skill-'));
    const lines: string[] = [];
    await runWorkspaceSetup(wt, wt, (l) => lines.push(l));
    expect(existsSync(join(wt, REVIEW_SKILL_PATH))).toBe(false);
    expect(existsSync(join(wt, CONTEXT_REVIEW_PATH))).toBe(true);
    expect(lines.join('\n')).toMatch(/\.context\/review\.md/);
  });

  it('copies the main repo .sideboard/review.md into the worktree .context', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'sideboard-review-repo-'));
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-review-wt-'));
    mkdirSync(join(repo, '.sideboard'), { recursive: true });
    writeFileSync(join(repo, REPO_REVIEW_PATH), '## Recommendation\nfrom repo\n');
    const lines: string[] = [];
    await runWorkspaceSetup(repo, wt, (l) => lines.push(l));
    expect(existsSync(join(wt, REVIEW_SKILL_PATH))).toBe(false);
    expect(readFileSync(join(wt, CONTEXT_REVIEW_PATH), 'utf8')).toContain('from repo');
    expect(existsSync(join(wt, REPO_REVIEW_PATH))).toBe(false);
  });
});

describe('killListenersOnPorts', () => {
  it('is a no-op for invalid ports', () => {
    expect(() => killListenersOnPorts([0, -1, Number.NaN])).not.toThrow();
  });

  it('does not include this process in the pids to signal', () => {
    expect(killableListenerPids(`12\n${process.pid}\n34\n`, process.pid)).toEqual([12, 34]);
    expect(killableListenerPids(String(process.pid), process.pid)).toEqual([]);
  });

  it('does not SIGTERM this process when it owns the listener', async () => {
    const { createServer } = await import('node:net');
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') reject(new Error('no port'));
        else resolve(addr.port);
      });
    });
    expect(() => killListenersOnPorts([port])).not.toThrow();
    const stillListening = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(true));
      probe.listen(port, '127.0.0.1', () => {
        probe.close(() => resolve(false));
      });
    });
    expect(stillListening).toBe(true);
    await new Promise<void>((res) => server.close(() => res()));
  });
});

describe('reservePort', () => {
  it('holds the port until release so a second reserve cannot steal it', async () => {
    const { createServer } = await import('node:net');
    const held = await reservePort();
    const conflict = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(true));
      server.listen(held.port, '127.0.0.1', () => {
        server.close(() => resolve(false));
      });
    });
    expect(conflict).toBe(true);
    await held.release();
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(held.port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
    expect(free).toBe(true);
  });
});

describe('isOtherWorktreeListenerCwd', () => {
  it('treats sibling worktree dirs as foreign and this tree as ours', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sideboard-cwd-'));
    const here = join(parent, 'nycfc');
    const other = join(parent, 'ajax');
    mkdirSync(here);
    mkdirSync(other);
    mkdirSync(join(here, 'apps'));
    expect(isOtherWorktreeListenerCwd(other, here)).toBe(true);
    expect(isOtherWorktreeListenerCwd(here, here)).toBe(false);
    expect(isOtherWorktreeListenerCwd(join(here, 'apps'), here)).toBe(false);
    expect(isOtherWorktreeListenerCwd(join(tmpdir(), 'unrelated'), here)).toBe(false);
  });
});

async function occupyPort(port: number, cwd: string) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `require('net').createServer().listen(${port}, '127.0.0.1', () => process.stdout.write('ready'));`,
    ],
    { cwd, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  let ready = false;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child did not listen')), 4000);
    child.stdout?.once('data', () => {
      ready = true;
      clearTimeout(timer);
      resolve();
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      if (ready) return;
      clearTimeout(timer);
      reject(new Error(`child exited ${code}`));
    });
  });
  return child;
}

describe('reservePortRange sticky ports', () => {
  it('reuses preferred ports when they are free', async () => {
    const first = await reservePortRange(2);
    const ports = first.map((h) => h.port);
    await Promise.all(first.map((h) => h.release()));
    const again = await reservePortRange(2, { preferred: ports });
    expect(again.map((h) => h.port)).toEqual(ports);
    await Promise.all(again.map((h) => h.release()));
  });

  it('kills a leftover listener in this worktree and reuses the port', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-reclaim-'));
    const probe = await reservePort();
    const port = probe.port;
    await probe.release();
    const child = await occupyPort(port, wt);
    try {
      const held = await reservePortRange(1, { preferred: [port], worktreePath: wt });
      expect(held[0]!.port).toBe(port);
      await held[0]!.release();
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('does not steal a sibling worktree listener', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'sideboard-sib-'));
    const here = join(parent, 'nycfc');
    const other = join(parent, 'ajax');
    mkdirSync(here);
    mkdirSync(other);
    const probe = await reservePort();
    const port = probe.port;
    await probe.release();
    const child = await occupyPort(port, other);
    try {
      const held = await reservePortRange(1, { preferred: [port], worktreePath: here });
      expect(held[0]!.port).not.toBe(port);
      await held[0]!.release();
      expect(child.exitCode).toBeNull();
      expect(child.killed).toBe(false);
    } finally {
      child.kill('SIGKILL');
    }
  });
});

describe('startDevServer sticky ports', () => {
  it('persists ports and reuses them on the next start', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'sideboard-sticky-dev-'));
    mkdirSync(join(wt, '.sideboard'));
    writeFileSync(
      join(wt, '.sideboard', 'settings.toml'),
      `[scripts.run.dev]\ncommand = "echo ok"\n`,
    );
    const first = await startDevServer(wt, wt);
    expect(first).not.toBeNull();
    const ports = first!.ports;
    expect(ports.length).toBeGreaterThan(0);
    expect(loadWorktreeRunPorts(wt, 'dev')).toEqual(ports);
    first!.kill();
    await first!.done;
    const second = await startDevServer(wt, wt);
    expect(second!.ports).toEqual(ports);
    second!.kill();
    await second!.done;
  });
});
