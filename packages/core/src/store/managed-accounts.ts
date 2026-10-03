import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appDataDir } from './paths.js';
import type { AgentKind, Thread } from '../types/thread.js';

export type ManagedAccountKind = 'claude' | 'codex';

export type ManagedAccount = {
  id: string;
  kind: ManagedAccountKind;
  label: string;
  configDir: string;
  createdAt: string;
};

export type ManagedAccountsState = {
  accounts: ManagedAccount[];
  activeClaudeAccountId: string | null;
  activeCodexAccountId: string | null;
};

export const EMPTY_MANAGED_ACCOUNTS: ManagedAccountsState = {
  accounts: [],
  activeClaudeAccountId: null,
  activeCodexAccountId: null,
};

export function isManagedAccountKind(value: unknown): value is ManagedAccountKind {
  return value === 'claude' || value === 'codex';
}

export function systemConfigDir(kind: ManagedAccountKind): string {
  return kind === 'claude' ? join(homedir(), '.claude') : join(homedir(), '.codex');
}

export function managedAccountConfigDir(kind: ManagedAccountKind, id: string): string {
  return join(appDataDir(), 'accounts', kind, id);
}

export function activeAccountId(
  kind: ManagedAccountKind,
  state: ManagedAccountsState,
): string | null {
  return kind === 'claude' ? state.activeClaudeAccountId : state.activeCodexAccountId;
}

export function findManagedAccount(
  state: ManagedAccountsState,
  id: string | null | undefined,
  kind?: ManagedAccountKind,
): ManagedAccount | null {
  if (!id) return null;
  return (
    state.accounts.find((a) => a.id === id && (kind == null || a.kind === kind)) ?? null
  );
}

/**
 * Pinned thread account, else the active selection for that agent.
 * `null` means system default (`~/.claude` / `~/.codex`).
 */
export function resolveAccountForThread(
  thread: Pick<Thread, 'agent' | 'accountId'>,
  state: ManagedAccountsState,
): ManagedAccount | null {
  if (thread.agent !== 'claude' && thread.agent !== 'codex') return null;
  const kind = thread.agent;
  if (thread.accountId !== undefined) {
    return findManagedAccount(state, thread.accountId, kind);
  }
  return findManagedAccount(state, activeAccountId(kind, state), kind);
}

/** Pin on first spawn so `--resume` stays on the account that started the session. */
export function accountIdToPin(
  thread: Pick<Thread, 'agent' | 'accountId'>,
  state: ManagedAccountsState,
): string | null | undefined {
  if (thread.agent !== 'claude' && thread.agent !== 'codex') return undefined;
  if (thread.accountId !== undefined) return thread.accountId;
  return activeAccountId(thread.agent, state);
}

export function applyManagedAccountEnv(
  env: NodeJS.ProcessEnv,
  agent: AgentKind,
  account: ManagedAccount | null,
): void {
  if (!account) return;
  if (agent === 'claude' && account.kind === 'claude') {
    env.CLAUDE_CONFIG_DIR = account.configDir;
  }
  if (agent === 'codex' && account.kind === 'codex') {
    env.CODEX_HOME = account.configDir;
  }
}

export type NextManagedAccount = {
  accountId: string | null;
  label: string;
};

/**
 * Cycle system default → managed accounts of this kind.
 * `null` currentId is system default. Returns null when there is nowhere to go.
 */
export function nextManagedAccount(
  kind: ManagedAccountKind,
  currentId: string | null | undefined,
  state: ManagedAccountsState,
): NextManagedAccount | null {
  const list = state.accounts.filter((a) => a.kind === kind);
  if (list.length === 0) return null;
  const slots: Array<{ accountId: string | null; label: string }> = [
    { accountId: null, label: 'System default' },
    ...list.map((a) => ({ accountId: a.id, label: a.label })),
  ];
  const idx = slots.findIndex((s) => s.accountId === (currentId ?? null));
  const from = idx < 0 ? 0 : idx;
  const next = slots[(from + 1) % slots.length];
  if (!next || next.accountId === (currentId ?? null)) return null;
  return next;
}

export function ensureManagedAccountDir(
  kind: ManagedAccountKind,
  id: string,
): string {
  const dir = managedAccountConfigDir(kind, id);
  mkdirSync(dir, { recursive: true });
  mirrorHostConfig(kind, dir);
  return dir;
}

/** Copy host settings so plugins/MCP the user already set are not missing. */
export function mirrorHostConfig(kind: ManagedAccountKind, destDir: string): void {
  const src = systemConfigDir(kind);
  const files = kind === 'claude' ? ['settings.json'] : ['config.toml'];
  for (const name of files) {
    const from = join(src, name);
    const to = join(destDir, name);
    if (!existsSync(from) || existsSync(to)) continue;
    try {
      copyFileSync(from, to);
    } catch {
      // ignore missing/unreadable host config
    }
  }
}

export function normalizeManagedAccounts(raw: unknown): ManagedAccountsState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_MANAGED_ACCOUNTS };
  const source = raw as Record<string, unknown>;
  const accounts: ManagedAccount[] = [];
  if (Array.isArray(source.accounts)) {
    for (const item of source.accounts) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.id !== 'string' || !rec.id.trim()) continue;
      if (!isManagedAccountKind(rec.kind)) continue;
      if (typeof rec.label !== 'string' || !rec.label.trim()) continue;
      if (typeof rec.configDir !== 'string' || !rec.configDir.trim()) continue;
      accounts.push({
        id: rec.id.trim(),
        kind: rec.kind,
        label: rec.label.trim().slice(0, 80),
        configDir: rec.configDir.trim(),
        createdAt:
          typeof rec.createdAt === 'string' && rec.createdAt.trim()
            ? rec.createdAt.trim()
            : new Date().toISOString(),
      });
    }
  }
  const claudeId =
    typeof source.activeClaudeAccountId === 'string' && source.activeClaudeAccountId.trim()
      ? source.activeClaudeAccountId.trim()
      : null;
  const codexId =
    typeof source.activeCodexAccountId === 'string' && source.activeCodexAccountId.trim()
      ? source.activeCodexAccountId.trim()
      : null;
  return {
    accounts,
    activeClaudeAccountId: accounts.some((a) => a.id === claudeId && a.kind === 'claude')
      ? claudeId
      : null,
    activeCodexAccountId: accounts.some((a) => a.id === codexId && a.kind === 'codex')
      ? codexId
      : null,
  };
}

export function withAddedAccount(
  state: ManagedAccountsState,
  account: ManagedAccount,
): ManagedAccountsState {
  const accounts = [...state.accounts.filter((a) => a.id !== account.id), account];
  if (account.kind === 'claude') {
    return { ...state, accounts, activeClaudeAccountId: account.id };
  }
  return { ...state, accounts, activeCodexAccountId: account.id };
}

export function withSelectedAccount(
  state: ManagedAccountsState,
  kind: ManagedAccountKind,
  accountId: string | null,
): ManagedAccountsState {
  if (accountId && !findManagedAccount(state, accountId, kind)) {
    accountId = null;
  }
  if (kind === 'claude') return { ...state, activeClaudeAccountId: accountId };
  return { ...state, activeCodexAccountId: accountId };
}

export function withRemovedAccount(
  state: ManagedAccountsState,
  id: string,
): ManagedAccountsState {
  const accounts = state.accounts.filter((a) => a.id !== id);
  return {
    accounts,
    activeClaudeAccountId:
      state.activeClaudeAccountId === id ? null : state.activeClaudeAccountId,
    activeCodexAccountId:
      state.activeCodexAccountId === id ? null : state.activeCodexAccountId,
  };
}

export function loginEnvPrefix(account: ManagedAccount): string {
  const key = account.kind === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
  const escaped = account.configDir.replace(/'/g, `'\\''`);
  return `export ${key}='${escaped}'`;
}
