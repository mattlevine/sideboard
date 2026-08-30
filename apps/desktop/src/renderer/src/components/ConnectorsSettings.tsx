import { useEffect, useState } from 'react';
import type {
  OptionalServiceCliStatus,
  OptionalServiceId,
  OptionalServiceSpec,
  PublicAppSettings,
} from '@sideboard-ai/core';
import {
  OPTIONAL_SERVICES,
  optionalConnected,
  optionalHost,
  optionalViewerName,
} from '../lib/optional-services';

export function ConnectorsSettings({
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
  const [optionalDrafts, setOptionalDrafts] = useState<
    Record<OptionalServiceId, { token: string; host: string; show: boolean; open: boolean }>
  >({
    vercel: { token: '', host: '', show: false, open: false },
    supabase: { token: '', host: '', show: false, open: false },
    posthog: { token: '', host: '', show: false, open: false },
    sentry: { token: '', host: '', show: false, open: false },
  });
  const [optionalBusy, setOptionalBusy] = useState<OptionalServiceId | null>(null);
  const [cliStatus, setCliStatus] = useState<
    Partial<Record<OptionalServiceId, OptionalServiceCliStatus>>
  >({});
  const [cliBusy, setCliBusy] = useState<OptionalServiceId | null>(null);
  const [cliNote, setCliNote] = useState<Partial<Record<OptionalServiceId, string>>>({});

  async function refreshCliStatus() {
    if (typeof window.sideboard.detectOptionalServiceClis !== 'function') return;
    try {
      const list = await window.sideboard.detectOptionalServiceClis();
      const next: Partial<Record<OptionalServiceId, OptionalServiceCliStatus>> = {};
      for (const row of list) next[row.id] = row;
      setCliStatus(next);
    } catch {
      // Keep the last known PATH status.
    }
  }

  useEffect(() => {
    void refreshCliStatus();
  }, []);

  useEffect(() => {
    setOptionalDrafts((prev) => ({
      ...prev,
      posthog: {
        ...prev.posthog,
        host: settings.integrations.posthogHost?.trim() || prev.posthog.host,
      },
      sentry: {
        ...prev.sentry,
        host: settings.integrations.sentryHost?.trim() || prev.sentry.host,
      },
    }));
  }, [settings.integrations.posthogHost, settings.integrations.sentryHost]);

  async function connectOptional(spec: OptionalServiceSpec) {
    const draft = optionalDrafts[spec.id];
    if (!draft.token.trim()) return;
    setOptionalBusy(spec.id);
    setError(null);
    try {
      const next = await window.sideboard.connectOptionalService({
        id: spec.id,
        token: draft.token.trim(),
        host: spec.hostPlaceholder ? draft.host.trim() || null : null,
      });
      applySettings(next);
      setOptionalDrafts((prev) => ({
        ...prev,
        [spec.id]: { ...prev[spec.id], token: '', open: false },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptionalBusy(null);
    }
  }

  async function disconnectOptional(id: OptionalServiceId) {
    setOptionalBusy(id);
    setError(null);
    try {
      const next = await window.sideboard.disconnectOptionalService(id);
      applySettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptionalBusy(null);
    }
  }

  async function installCli(id: OptionalServiceId) {
    setCliBusy(id);
    setError(null);
    try {
      const result = await window.sideboard.installOptionalServiceCli(id);
      setCliNote((prev) => ({ ...prev, [id]: result.message }));
      if (!result.ok) setError(result.message);
      await refreshCliStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCliBusy(null);
    }
  }

  return (
    <div className="settings-body">
      <p className="settings-lead">
        Optional project services. Slack lives under Remote. Agents use official CLIs (or the
        PostHog HTTP API) with tokens stored here — not vendor MCPs. Install CLI appears when{' '}
        <code>vercel</code>, <code>supabase</code>, or <code>sentry-cli</code> is missing — not on
        Connect.
      </p>

      <div className="settings-optional-list">
        {OPTIONAL_SERVICES.map((spec) => {
          const connected = optionalConnected(spec.id, settings.integrations);
          const viewer = optionalViewerName(spec.id, settings.integrations);
          const storedHost = optionalHost(spec.id, settings.integrations);
          const draft = optionalDrafts[spec.id];
          const open = draft.open || (!connected && draft.token.length > 0);
          const checking = optionalBusy === spec.id;
          const cli = cliStatus[spec.id];
          const showInstall = Boolean(spec.cli && cli && !cli.installed);
          const installing = cliBusy === spec.id;
          const cliLabel = cli?.installed
            ? 'CLI ready'
            : spec.cli && cli && !cli.installed
              ? 'CLI missing'
              : null;
          return (
            <div
              key={spec.id}
              className="settings-section settings-section-card settings-optional-row"
            >
              <div className="settings-toggle-row">
                <div>
                  <div className="settings-section-title">{spec.label}</div>
                  <p className="settings-hint">{spec.hint}</p>
                  {connected ? (
                    <p className="settings-status-text" style={{ marginTop: 8 }}>
                      <span
                        className="settings-dot ok"
                        style={{ display: 'inline-block', marginRight: 8 }}
                      />
                      {['Connected', viewer, storedHost, cliLabel].filter(Boolean).join(' · ')}
                    </p>
                  ) : (
                    <p className="settings-hint" style={{ marginTop: 8 }}>
                      {['Off', cliLabel].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="row" style={{ gap: 8, margin: 0 }}>
                  {connected ? (
                    <button
                      type="button"
                      disabled={busy || checking}
                      onClick={() => void disconnectOptional(spec.id)}
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={open ? '' : 'primary'}
                      disabled={busy || checking}
                      onClick={() =>
                        setOptionalDrafts((prev) => ({
                          ...prev,
                          [spec.id]: { ...prev[spec.id], open: !prev[spec.id].open },
                        }))
                      }
                    >
                      {open ? 'Cancel' : 'Connect'}
                    </button>
                  )}
                  {showInstall ? (
                    <button
                      type="button"
                      disabled={busy || checking || cliBusy != null}
                      onClick={() => void installCli(spec.id)}
                    >
                      {installing ? 'Installing…' : 'Install CLI'}
                    </button>
                  ) : null}
                </div>
              </div>
              {!connected && open ? (
                <div style={{ marginTop: 12 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      type={draft.show ? 'text' : 'password'}
                      value={draft.token}
                      onChange={(e) =>
                        setOptionalDrafts((prev) => ({
                          ...prev,
                          [spec.id]: { ...prev[spec.id], token: e.target.value },
                        }))
                      }
                      placeholder={spec.tokenPlaceholder}
                      style={{ flex: 1 }}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="settings-inline-btn"
                      onClick={() =>
                        setOptionalDrafts((prev) => ({
                          ...prev,
                          [spec.id]: { ...prev[spec.id], show: !prev[spec.id].show },
                        }))
                      }
                    >
                      {draft.show ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || checking || !draft.token.trim()}
                      onClick={() => void connectOptional(spec)}
                    >
                      {checking ? 'Checking…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="settings-inline-btn"
                      onClick={() => {
                        void window.sideboard.openExternal(spec.tokenDocs);
                      }}
                    >
                      Create token
                    </button>
                  </div>
                  {spec.hostPlaceholder ? (
                    <input
                      value={draft.host}
                      onChange={(e) =>
                        setOptionalDrafts((prev) => ({
                          ...prev,
                          [spec.id]: { ...prev[spec.id], host: e.target.value },
                        }))
                      }
                      placeholder={spec.hostPlaceholder}
                      style={{ marginTop: 8, width: '100%' }}
                      autoComplete="off"
                    />
                  ) : null}
                </div>
              ) : null}
              {cliNote[spec.id] ? (
                <p className="settings-hint" style={{ marginTop: 8 }}>
                  {cliNote[spec.id]}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
