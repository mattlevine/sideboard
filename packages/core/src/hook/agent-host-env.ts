import { delimiter } from 'node:path';

/**
 * `pnpm dev` / electron-vite leak host-tooling env into agent children.
 * Claude then treats the Sideboard checkout as the project (INIT_CWD, NODE_PATH)
 * or loads electron-vite's Node module graph and never emits stream-json init.
 * Packaged Sideboard.app does not set these keys.
 */
const DROP_EXACT = new Set([
  'NODE_PATH',
  'NODE_ENV_ELECTRON_VITE',
  'INIT_CWD',
  'npm_command',
  'npm_execpath',
  'npm_node_execpath',
  'npm_lifecycle_event',
  'npm_lifecycle_script',
  'PNPM_SCRIPT_SRC_DIR',
  'PNPM_STORE_DIR',
  'PORT',
  'SIDEBOARD_ROOT_PATH',
  'SIDEBOARD_IS_LOCAL',
  'SIDEBOARD_WORKSPACE_PATH',
  'SIDEBOARD_WORKSPACE_NAME',
  'SIDEBOARD_PORT',
  'CONDUCTOR_ROOT_PATH',
  'CONDUCTOR_IS_LOCAL',
  'CONDUCTOR_WORKSPACE_PATH',
  'CONDUCTOR_WORKSPACE_NAME',
  'CONDUCTOR_PORT',
  'CONDUCTOR_DEFAULT_BRANCH',
  'SIDEBOARD_DEFAULT_BRANCH',
]);

const DROP_PREFIXES = [
  'npm_package_',
  'npm_config_',
  'PNPM_',
  'SIDEBOARD_PORT_',
  'CONDUCTOR_PORT_',
] as const;

const HOST_PATH_NOISE =
  /(?:^|\/)node_modules\/\.bin(?:\/|$)|node-gyp-bin|electron-vite/i;

export function isAgentHostEnvKey(key: string): boolean {
  if (DROP_EXACT.has(key)) return true;
  return DROP_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Drop pnpm / electron-vite `node_modules/.bin` so `claude` / `node` resolve normally. */
export function stripHostToolingPath(pathValue: string | undefined): string {
  if (!pathValue?.trim()) return '';
  return pathValue
    .split(delimiter)
    .filter((part) => part && !HOST_PATH_NOISE.test(part.replace(/\\/g, '/')))
    .join(delimiter);
}

/**
 * Strip host `pnpm dev` / Sideboard-terminal env from an agent child.
 * Keeps `SIDEBOARD_APP_DATA` so injected MCP still hits this desktop store.
 * Sets `PWD` / `INIT_CWD` to the thread worktree when `cwd` is passed.
 */
export function sanitizeAgentHostEnv(
  env: NodeJS.ProcessEnv,
  cwd?: string,
): NodeJS.ProcessEnv {
  for (const key of Object.keys(env)) {
    if (isAgentHostEnvKey(key)) delete env[key];
  }
  env.PATH = stripHostToolingPath(env.PATH);
  const worktree = cwd?.trim();
  if (worktree) {
    env.PWD = worktree;
    env.INIT_CWD = worktree;
  }
  return env;
}
