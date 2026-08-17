/**
 * Host Electron leaks Chromium / electron-vite env into child processes.
 * Nested Electron (this repo's desktop `dev`, Claude Code, Cursor local
 * agents, MCP started via Electron-as-Node) then attaches to the parent's
 * GPU/crashpad and dies:
 *   GPU process exited unexpectedly
 *   v8::ValueSerializer::Delegate::HasCustomHostObject
 *   ElectronInitializeICUandStartNode
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
