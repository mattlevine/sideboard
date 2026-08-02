import { homedir } from 'node:os';
import { delimiter } from 'node:path';

const EXTRA_BIN_DIRS = [
  '.local/bin',
  '.cargo/bin',
  '.nvm/current/bin',
  '.asdf/shims',
  // pnpm / npm global bins (where `@brightsy/cli` typically lands)
  'Library/pnpm',
  '.pnpm',
] as const;

/**
 * Electron / GUI apps often inherit a minimal PATH that omits Homebrew and
 * user bin dirs where `claude` / `codex` / `opencode` / `brightsy` live. Call
 * once at process start (and before agent spawns) so adapters can resolve CLIs.
 */
export function ensureAgentPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  const current = env.PATH ?? '';
  const parts = current.split(delimiter).filter(Boolean);
  const seen = new Set(parts);

  const extras: string[] = [
    ...EXTRA_BIN_DIRS.map((rel) => `${home}/${rel}`),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];

  for (const dir of extras.reverse()) {
    if (!dir || seen.has(dir)) continue;
    parts.unshift(dir);
    seen.add(dir);
  }

  const next = parts.join(delimiter);
  env.PATH = next;
  return next;
}
