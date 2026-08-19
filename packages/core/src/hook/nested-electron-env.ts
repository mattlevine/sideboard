/**
 * Host Electron leaks Chromium / electron-vite env into child processes.
 * Nested Electron (this repo's desktop `dev`, Claude Code, Cursor local
 * agents, MCP started via Electron-as-Node) then attaches to the parent's
 * GPU/crashpad and dies:
 *   GPU process exited unexpectedly
 *   v8::ValueSerializer::Delegate::HasCustomHostObject
 *   ElectronInitializeICUandStartNode
 *
 * Stripping at spawn is not enough when the *immediate* parent is also
 * Electron (Cursor's local agent). That host merges MCP env on top of its
 * own `CHROME_CRASHPAD_PIPE_NAME`, and the crash happens in
 * `ElectronInitializeICUandStartNode` — before any JS (`dropNestedElectronEnvFromProcess`)
 * can run. Wrap Electron-as-Node with {@link wrapElectronAsNodeLaunch}.
 */
const NESTED_ELECTRON_ENV_PREFIXES = ['ELECTRON_', 'CHROME_'] as const;

export function isNestedElectronEnvKey(key: string): boolean {
  return NESTED_ELECTRON_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function stripNestedElectronEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(out)) {
    if (isNestedElectronEnvKey(key)) delete out[key];
  }
  return out;
}

/**
 * Drop host Electron/Chromium keys from *this* process so later children
 * (Cursor SDK local agent, MCP) do not inherit them. Safe after Electron-as-Node
 * has already started — `ELECTRON_RUN_AS_NODE` is read at process launch.
 */
export function dropNestedElectronEnvFromProcess(
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of Object.keys(env)) {
    if (isNestedElectronEnvKey(key)) delete env[key];
  }
}

/**
 * POSIX `sh -c` body: drop inherited Electron/Chromium keys, then exec.
 * `$0` is a dummy; `"$@"` is the Electron binary + script args.
 * Re-export `ELECTRON_RUN_AS_NODE` after unset so asar scripts still run.
 */
export const STRIP_NESTED_ELECTRON_THEN_EXEC = [
  'vars=`printenv | awk -F= \'/^(ELECTRON_|CHROME_)/{print $1}\'`',
  '[ -n "$vars" ] && unset $vars',
  'export ELECTRON_RUN_AS_NODE=1',
  'exec "$@"',
].join('; ');

/**
 * Launch `file args` so a nested Electron parent (Cursor local agent / Cursor
 * IDE) cannot pass crashpad/GPU env into Electron-as-Node. No-op on win32.
 */
export function wrapElectronAsNodeLaunch(
  file: string,
  args: string[],
): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file, args };
  return {
    file: '/bin/sh',
    args: ['-c', STRIP_NESTED_ELECTRON_THEN_EXEC, 'sh', file, ...args],
  };
}

/** True when `command`/`args` already run {@link STRIP_NESTED_ELECTRON_THEN_EXEC}. */
export function isStrippedElectronLaunch(
  command: string,
  args?: string[],
): boolean {
  return (
    command === '/bin/sh' &&
    Boolean(args?.[1]?.includes('ELECTRON_RUN_AS_NODE') && args[1].includes('unset'))
  );
}

/**
 * Electron GUI / Cursor local-agent binaries. Spawning these as MCP (even via
 * `ELECTRON_RUN_AS_NODE`) is what triggers nested `HasCustomHostObject`.
 * Do not treat `process.execPath` as Electron when this process is real Node
 * (tests, CLI) — that would wrap `node` with `ELECTRON_RUN_AS_NODE`.
 */
export function isElectronLikeCommand(command: string): boolean {
  const name = command.trim();
  if (!name) return false;
  if (process.versions.electron && name === process.execPath) return true;
  return (
    /(?:^|[/\\])Electron(?:\.exe)?$/i.test(name) ||
    /Sideboard\.app[/\\]/i.test(name) ||
    /Electron\.app[/\\]/i.test(name)
  );
}

/** Binary + script args inside a {@link wrapElectronAsNodeLaunch} `/bin/sh -c` argv. */
export function unwrapStrippedElectronLaunch(
  command: string,
  args?: string[],
): { file: string; args: string[] } | null {
  if (!isStrippedElectronLaunch(command, args) || !args || args.length < 4) {
    return null;
  }
  return { file: args[3]!, args: args.slice(4) };
}
