import { listWorkspaces } from './workspaces.js';
import { loadAppSettings, updateAppEnvironment } from './app-settings.js';
import { matchRegisteredWorkspace } from '../mcp/viewer-context-tools.js';

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type EnvScope = 'account' | 'project';

export interface EnvKeyInfo {
  key: string;
  scope: EnvScope;
  project?: string;
  prefix?: string;
}

/** Uppercase project name plus `_`, used so project secrets do not clobber account env. */
export function projectEnvPrefix(projectName: string): string {
  const slug = projectName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
    .slice(0, 40);
  return `${slug || 'PROJECT'}_`;
}

export function assertEnvKey(key: string): string {
  const k = key.trim();
  if (!ENV_KEY.test(k)) {
    throw new Error(
      `Invalid env key "${key}". Use letters, digits, and underscores, starting with a letter or underscore.`,
    );
  }
  return k;
}

/** Store `APPLE_ID` for project sideboard as `SIDEBOARD_APPLE_ID`. Do not double-prefix. */
export function qualifyProjectEnvKey(prefix: string, key: string): string {
  const k = assertEnvKey(key);
  if (k.toUpperCase().startsWith(prefix)) return prefix + k.slice(prefix.length);
  return prefix + k;
}

export function projectNameForRepoPath(repoPath?: string | null): string | null {
  const matched = matchRegisteredWorkspace(repoPath);
  if (!matched) return null;
  const found = listWorkspaces().find((w) => w.path.replace(/\/+$/, '') === matched);
  return found?.name?.trim() || null;
}

function projectPrefixes(): Array<{ name: string; prefix: string }> {
  return listWorkspaces()
    .map((w) => ({ name: w.name.trim(), prefix: projectEnvPrefix(w.name) }))
    .filter((p) => p.name && p.prefix !== 'PROJECT_')
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

export function classifyEnvKey(key: string): Omit<EnvKeyInfo, 'key'> {
  const hit = projectPrefixes().find((p) => key.startsWith(p.prefix));
  if (!hit) return { scope: 'account' };
  return { scope: 'project', project: hit.name, prefix: hit.prefix };
}

export function listEnvKeys(): EnvKeyInfo[] {
  return Object.keys(loadAppSettings().environment)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, ...classifyEnvKey(key) }));
}

export function setEnvVar(input: {
  key: string;
  value: string;
  scope: EnvScope;
  projectName?: string | null;
}): { key: string; scope: EnvScope; prefix?: string; project?: string } {
  const value = input.value;
  if (input.scope === 'account') {
    const key = assertEnvKey(input.key);
    if (value.trim() === '') {
      updateAppEnvironment({ [key]: null });
      return { key, scope: 'account' };
    }
    updateAppEnvironment({ [key]: value });
    return { key, scope: 'account' };
  }
  const project = input.projectName?.trim();
  if (!project) throw new Error('Project name required for scope=project.');
  const prefix = projectEnvPrefix(project);
  const key = qualifyProjectEnvKey(prefix, input.key);
  if (value.trim() === '') {
    updateAppEnvironment({ [key]: null });
  } else {
    updateAppEnvironment({ [key]: value });
  }
  return { key, scope: 'project', prefix, project };
}

export function deleteEnvVar(input: {
  key: string;
  scope: EnvScope;
  projectName?: string | null;
}): { key: string; scope: EnvScope; deleted: boolean; prefix?: string; project?: string } {
  const current = loadAppSettings().environment;
  if (input.scope === 'account') {
    const key = assertEnvKey(input.key);
    const deleted = Object.prototype.hasOwnProperty.call(current, key);
    updateAppEnvironment({ [key]: null });
    return { key, scope: 'account', deleted };
  }
  const project = input.projectName?.trim();
  if (!project) throw new Error('Project name required for scope=project.');
  const prefix = projectEnvPrefix(project);
  const key = qualifyProjectEnvKey(prefix, input.key);
  const deleted = Object.prototype.hasOwnProperty.call(current, key);
  updateAppEnvironment({ [key]: null });
  return { key, scope: 'project', deleted, prefix, project };
}

export function formatEnvDirective(projectName: string | null): string {
  if (!projectName) {
    return [
      'Sideboard environment (Settings → Environment): list_env, set_env, delete_env.',
      'scope=project prefixes the key with the registered project name (uppercased, then _). APPLE_ID for a project named sideboard is stored as SIDEBOARD_APPLE_ID.',
      'scope=account is shared by every project and is not prefixed.',
      'list_env returns names only. A value is injected into later agent turns.',
    ].join(' ');
  }
  const prefix = projectEnvPrefix(projectName);
  return [
    'Sideboard environment (Settings → Environment): list_env, set_env, delete_env.',
    `This project's prefix is ${prefix}. Project secrets must use that prefix — set_env scope=project applies it (APPLE_ID becomes ${prefix}APPLE_ID).`,
    'scope=account is only for variables shared by every project.',
    'list_env returns names only. A value set here is injected into later agent turns.',
  ].join(' ');
}

export function formatEnvReminder(projectName: string | null): string {
  if (!projectName) {
    return 'Sideboard env: list_env / set_env / delete_env. scope=project prefixes the key with the project name (SIDEBOARD_APPLE_ID). scope=account is shared by every project.';
  }
  const prefix = projectEnvPrefix(projectName);
  return `Sideboard env: list_env / set_env / delete_env. This project's prefix is ${prefix}. scope=project stores ${prefix}<NAME>. scope=account is shared by every project.`;
}
