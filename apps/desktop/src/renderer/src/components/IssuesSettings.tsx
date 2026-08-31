import { useEffect, useState } from 'react';
import type { IssueSource, PublicAppSettings } from '@sideboard-ai/core';

function isOauthCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /sign-in cancelled/i.test(message);
}

export function IssuesSettings({
  settings,
  applySettings,
  busy,
  setBusy,
  setError,
}: {
  settings: PublicAppSettings;
  applySettings: (next: PublicAppSettings) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}) {
  const [linearKeyDraft, setLinearKeyDraft] = useState('');
  const [showLinearKey, setShowLinearKey] = useState(false);
  const [abletimeTokenDraft, setAbletimeTokenDraft] = useState('');
  const [showAbletimeToken, setShowAbletimeToken] = useState(false);
  const [abletimeHostDraft, setAbletimeHostDraft] = useState('');
  const [abletimeBusy, setAbletimeBusy] = useState(false);
  const [linearOauthBusy, setLinearOauthBusy] = useState(false);

  useEffect(() => {
    setAbletimeHostDraft(settings.integrations.abletimeHost?.trim() || '');
  }, [settings.integrations.abletimeHost]);

  async function saveIntegrationsPatch(patch: {
    linearApiKey?: string | null;
    issueSource?: IssueSource | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateIntegrationsSettings(patch);
      applySettings(next);
      setLinearKeyDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-body">
      <p className="settings-lead">
        Preferred tracker for Create-from and Home. Falls back to GitHub Issues if the preferred
        one is not connected.
      </p>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">Issue source</div>
        <p className="settings-hint">
          When AbleTime is selected, new work without a ticket auto-creates a task to track
          against.
        </p>
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          {(
            [
              { id: 'github' as const, label: 'GitHub Issues' },
              { id: 'linear' as const, label: 'Linear' },
              { id: 'abletime' as const, label: 'AbleTime' },
            ]
          ).map((opt) => {
            const preferred = settings.integrations.issueSource ?? 'github';
            const active = preferred === opt.id;
            const linearOk = Boolean(settings.integrations.hasLinearApiKey);
            const abletimeOk = Boolean(settings.integrations.hasAbleTimeToken);
            const disabled =
              (opt.id === 'linear' && !linearOk) || (opt.id === 'abletime' && !abletimeOk);
            return (
              <button
                key={opt.id}
                type="button"
                className={active ? 'primary' : ''}
                disabled={busy || disabled}
                title={
                  disabled
                    ? opt.id === 'abletime'
                      ? 'Connect AbleTime first'
                      : 'Connect Linear first'
                    : undefined
                }
                onClick={() => void saveIntegrationsPatch({ issueSource: opt.id })}
              >
                {opt.label}
                {opt.id === 'linear' && !linearOk ? ' (not connected)' : ''}
                {opt.id === 'abletime' && !abletimeOk ? ' (not connected)' : ''}
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">Linear</div>
        <p className="settings-hint">
          List, create, update, and comment on issues. Sign in with your browser — same pattern as
          Slack. If you connected before write access shipped, Disconnect and Connect via browser
          again.
        </p>
        {settings.integrations.hasLinearApiKey ? (
          <div className="settings-toggle-row" style={{ marginTop: 10 }}>
            <div>
              <p className="settings-status-text">
                <span
                  className="settings-dot ok"
                  style={{ display: 'inline-block', marginRight: 8 }}
                />
                {settings.integrations.hasLinearOAuth
                  ? [
                      'Connected',
                      settings.integrations.linearViewerName,
                      settings.integrations.linearOrganizationName,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Connected · key saved on this Mac'}
              </p>
            </div>
            <div className="row" style={{ gap: 8, margin: 0 }}>
              <button
                type="button"
                disabled={busy || linearOauthBusy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void window.sideboard
                    .disconnectLinear()
                    .then((next) => applySettings(next))
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setBusy(false));
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button
              type="button"
              className="primary"
              disabled={busy || linearOauthBusy}
              onClick={() => {
                setLinearOauthBusy(true);
                setError(null);
                void window.sideboard
                  .startLinearOAuth()
                  .then((next) => applySettings(next))
                  .catch((err) => {
                    if (isOauthCancelled(err)) return;
                    setError(err instanceof Error ? err.message : String(err));
                  })
                  .finally(() => setLinearOauthBusy(false));
              }}
            >
              {linearOauthBusy ? 'Waiting for Linear…' : 'Connect via browser'}
            </button>
            {linearOauthBusy ? (
              <button
                type="button"
                onClick={() => {
                  void window.sideboard.cancelLinearOAuth();
                }}
              >
                Cancel
              </button>
            ) : null}
            <input
              type={showLinearKey ? 'text' : 'password'}
              value={linearKeyDraft}
              onChange={(e) => setLinearKeyDraft(e.target.value)}
              placeholder="or paste lin_api_…"
              style={{ flex: 1 }}
              autoComplete="off"
            />
            <button
              type="button"
              disabled={busy || linearOauthBusy || !linearKeyDraft.trim()}
              onClick={() => void saveIntegrationsPatch({ linearApiKey: linearKeyDraft.trim() })}
            >
              Connect
            </button>
          </div>
        )}
      </div>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">AbleTime</div>
        <p className="settings-hint">
          List tasks and auto-create one when you start work without a ticket. Uses
          AbleTime&apos;s hosted MCP (<code>POST /api/public/v2/mcp</code>
          ). Enable <strong>Agent access (MCP)</strong> in AbleTime, then paste a personal access
          token from Profile → API Access (<code>apt_…</code>).
        </p>
        {settings.integrations.hasAbleTimeToken ? (
          <div className="settings-toggle-row" style={{ marginTop: 10 }}>
            <div>
              <p className="settings-status-text">
                <span
                  className="settings-dot ok"
                  style={{ display: 'inline-block', marginRight: 8 }}
                />
                {[
                  'Connected',
                  settings.integrations.abletimeViewerName,
                  settings.integrations.abletimeHost,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="row" style={{ gap: 8, margin: 0 }}>
              <button
                type="button"
                disabled={busy || abletimeBusy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void window.sideboard
                    .disconnectAbleTime()
                    .then((next) => applySettings(next))
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setBusy(false));
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <input
                type={showAbletimeToken ? 'text' : 'password'}
                value={abletimeTokenDraft}
                onChange={(e) => setAbletimeTokenDraft(e.target.value)}
                placeholder="apt_…"
                style={{ flex: 1 }}
                autoComplete="off"
              />
              <button
                type="button"
                className="settings-inline-btn"
                onClick={() => setShowAbletimeToken((v) => !v)}
              >
                {showAbletimeToken ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || abletimeBusy || !abletimeTokenDraft.trim()}
                onClick={() => {
                  setAbletimeBusy(true);
                  setError(null);
                  void window.sideboard
                    .connectAbleTime({
                      token: abletimeTokenDraft.trim(),
                      host: abletimeHostDraft.trim() || null,
                    })
                    .then((next) => {
                      applySettings(next);
                      setAbletimeTokenDraft('');
                    })
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setAbletimeBusy(false));
                }}
              >
                {abletimeBusy ? 'Checking…' : 'Connect'}
              </button>
            </div>
            <input
              value={abletimeHostDraft}
              onChange={(e) => setAbletimeHostDraft(e.target.value)}
              placeholder="https://track.abletime.com"
              style={{ marginTop: 8, width: '100%' }}
              autoComplete="off"
            />
          </div>
        )}
      </div>
    </div>
  );
}
