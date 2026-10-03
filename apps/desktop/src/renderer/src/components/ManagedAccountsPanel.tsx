import { useState } from 'react';
import type { ManagedAccountKind, PublicAppSettings } from '@sideboard-ai/core';

type Props = {
  kind: ManagedAccountKind;
  settings: PublicAppSettings;
  busy: boolean;
  onApply: (next: PublicAppSettings) => void;
  onError: (message: string | null) => void;
};

function activeId(kind: ManagedAccountKind, settings: PublicAppSettings): string | null {
  return kind === 'claude'
    ? settings.accounts?.activeClaudeAccountId ?? null
    : settings.accounts?.activeCodexAccountId ?? null;
}

export function ManagedAccountsPanel({ kind, settings, busy, onApply, onError }: Props) {
  const [label, setLabel] = useState('');
  const accounts = (settings.accounts?.accounts ?? []).filter((a) => a.kind === kind);
  const selected = activeId(kind, settings);
  const noun = kind === 'claude' ? 'Claude' : 'Codex';

  async function run(fn: () => Promise<PublicAppSettings>) {
    onError(null);
    try {
      onApply(await fn());
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="settings-section settings-section-card">
      <div className="settings-section-title">{noun} accounts</div>
      <p className="settings-hint">
        Isolated {kind === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'} homes. New chats use the
        selected account; a running session stays pinned to the account that started it.
      </p>
      <div className="managed-account-list">
        <label className="managed-account-row">
          <input
            type="radio"
            name={`${kind}-managed-account`}
            checked={!selected}
            disabled={busy}
            onChange={() => {
              void run(() => window.sideboard.selectManagedAccount(kind, null));
            }}
          />
          <span>System default</span>
        </label>
        {accounts.map((account) => (
          <div key={account.id} className="managed-account-row">
            <label>
              <input
                type="radio"
                name={`${kind}-managed-account`}
                checked={selected === account.id}
                disabled={busy}
                onChange={() => {
                  void run(() => window.sideboard.selectManagedAccount(kind, account.id));
                }}
              />
              <span>{account.label}</span>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void window.sideboard.loginManagedAccount(account.id).then((result) => {
                  if (!result.ok) onError(result.message);
                });
              }}
            >
              Log in
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run(() => window.sideboard.removeManagedAccount(account.id));
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="settings-key-row" style={{ marginTop: '0.5rem' }}>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={`Add ${noun} account`}
          value={label}
          disabled={busy}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !label.trim()}
          onClick={() => {
            const next = label.trim();
            setLabel('');
            void run(() => window.sideboard.addManagedAccount(kind, next));
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
