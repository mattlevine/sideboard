import { useEffect, useState } from 'react';
import type { AgentKind, PublicAppSettings } from '@sideboard-ai/core';

type Props = {
  agent: AgentKind;
  onChanged?: () => void;
};

function isManagedKind(agent: AgentKind): agent is 'claude' | 'codex' {
  return agent === 'claude' || agent === 'codex';
}

export function AccountSwitcher({ agent, onChanged }: Props) {
  const [settings, setSettings] = useState<PublicAppSettings | null>(null);

  useEffect(() => {
    if (!isManagedKind(agent)) return;
    void window.sideboard.getAppSettings().then(setSettings, () => setSettings(null));
  }, [agent]);

  if (!isManagedKind(agent) || !settings?.accounts) return null;
  const accounts = settings.accounts.accounts.filter((a) => a.kind === agent);
  if (accounts.length === 0) return null;
  const active =
    (agent === 'claude'
      ? settings.accounts.activeClaudeAccountId
      : settings.accounts.activeCodexAccountId) ?? '';

  return (
    <select
      className="account-switcher"
      aria-label={`${agent === 'claude' ? 'Claude' : 'Codex'} account`}
      title="Account for new turns. A running session stays on the account that started it."
      value={active}
      onChange={(e) => {
        const next = e.target.value || null;
        void window.sideboard.selectManagedAccount(agent, next).then((saved) => {
          setSettings(saved);
          onChanged?.();
        });
      }}
    >
      <option value="">System</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.label}
        </option>
      ))}
    </select>
  );
}
