import { describe, expect, it } from 'vitest';
import {
  applyManagedAccountEnv,
  EMPTY_MANAGED_ACCOUNTS,
  nextManagedAccount,
  normalizeManagedAccounts,
  resolveAccountForThread,
  accountIdToPin,
  withAddedAccount,
  withRemovedAccount,
  withSelectedAccount,
  type ManagedAccount,
  type ManagedAccountsState,
} from './managed-accounts.js';

const claudeA: ManagedAccount = {
  id: 'a',
  kind: 'claude',
  label: 'work',
  configDir: '/tmp/a',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const claudeB: ManagedAccount = {
  id: 'b',
  kind: 'claude',
  label: 'personal',
  configDir: '/tmp/b',
  createdAt: '2026-01-02T00:00:00.000Z',
};

const state: ManagedAccountsState = {
  accounts: [claudeA, claudeB],
  activeClaudeAccountId: 'a',
  activeCodexAccountId: null,
};

describe('normalizeManagedAccounts', () => {
  it('drops unknown kinds and dangling active ids', () => {
    expect(
      normalizeManagedAccounts({
        accounts: [
          claudeA,
          { id: 'x', kind: 'cursor', label: 'nope', configDir: '/x' },
          { id: '', kind: 'claude', label: 'empty', configDir: '/e' },
        ],
        activeClaudeAccountId: 'missing',
        activeCodexAccountId: 'a',
      }),
    ).toEqual({
      accounts: [claudeA],
      activeClaudeAccountId: null,
      activeCodexAccountId: null,
    });
  });
});

describe('resolveAccountForThread', () => {
  it('uses the pinned id even when a different account is active', () => {
    expect(
      resolveAccountForThread({ agent: 'claude', accountId: 'b' }, state)?.id,
    ).toBe('b');
  });

  it('falls back to the active selection when unpinned', () => {
    expect(
      resolveAccountForThread({ agent: 'claude', accountId: undefined }, state)?.id,
    ).toBe('a');
  });

  it('treats a pinned null as system default', () => {
    expect(resolveAccountForThread({ agent: 'claude', accountId: null }, state)).toBeNull();
  });
});

describe('accountIdToPin', () => {
  it('keeps an existing pin', () => {
    expect(accountIdToPin({ agent: 'claude', accountId: null }, state)).toBeNull();
    expect(accountIdToPin({ agent: 'claude', accountId: 'b' }, state)).toBe('b');
  });

  it('pins the active account on first spawn', () => {
    expect(accountIdToPin({ agent: 'claude', accountId: undefined }, state)).toBe('a');
    expect(accountIdToPin({ agent: 'cursor', accountId: undefined }, state)).toBeUndefined();
  });
});

describe('nextManagedAccount', () => {
  it('cycles system → first → second → system', () => {
    expect(nextManagedAccount('claude', null, state)).toEqual({
      accountId: 'a',
      label: 'work',
    });
    expect(nextManagedAccount('claude', 'a', state)).toEqual({
      accountId: 'b',
      label: 'personal',
    });
    expect(nextManagedAccount('claude', 'b', state)).toEqual({
      accountId: null,
      label: 'System default',
    });
  });

  it('returns null when there are no managed accounts', () => {
    expect(nextManagedAccount('claude', null, EMPTY_MANAGED_ACCOUNTS)).toBeNull();
  });
});

describe('applyManagedAccountEnv', () => {
  it('sets CLAUDE_CONFIG_DIR / CODEX_HOME only for matching agents', () => {
    const env: NodeJS.ProcessEnv = {};
    applyManagedAccountEnv(env, 'claude', claudeA);
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/a');
    expect(env.CODEX_HOME).toBeUndefined();
    applyManagedAccountEnv(env, 'codex', {
      ...claudeA,
      kind: 'codex',
      id: 'c',
    });
    expect(env.CODEX_HOME).toBe('/tmp/a');
  });
});

describe('selection helpers', () => {
  it('adds, selects, and removes', () => {
    let next = withAddedAccount(EMPTY_MANAGED_ACCOUNTS, claudeA);
    expect(next.activeClaudeAccountId).toBe('a');
    next = withSelectedAccount(next, 'claude', 'a');
    expect(next.activeClaudeAccountId).toBe('a');
    next = withRemovedAccount(next, 'a');
    expect(next.accounts).toEqual([]);
    expect(next.activeClaudeAccountId).toBeNull();
  });
});
