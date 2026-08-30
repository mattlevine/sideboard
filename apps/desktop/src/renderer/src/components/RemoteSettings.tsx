import { useEffect, useState } from 'react';
import type { PublicAppSettings, SlackListenStatus, SlackWorkspaceInfo } from '@sideboard-ai/core';

function isOauthCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /sign-in cancelled/i.test(message);
}

export function RemoteSettings({
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
  const [slackWorkspaces, setSlackWorkspaces] = useState<SlackWorkspaceInfo[]>([]);
  const [slackListen, setSlackListen] = useState<SlackListenStatus | null>(null);
  const [slackTokenDraft, setSlackTokenDraft] = useState('');
  const [slackOauthBusy, setSlackOauthBusy] = useState(false);
  const [slackDeviceLabelDraft, setSlackDeviceLabelDraft] = useState('');

  useEffect(() => {
    void Promise.all([
      window.sideboard.getSlackWorkspaces().catch(() => [] as SlackWorkspaceInfo[]),
      typeof window.sideboard.getSlackListenStatus === 'function'
        ? window.sideboard.getSlackListenStatus().catch(() => null)
        : Promise.resolve(null),
    ]).then(([slack, slackIn]) => {
      setSlackWorkspaces(slack);
      setSlackListen(slackIn);
      if (slackIn?.deviceLabel?.trim()) {
        setSlackDeviceLabelDraft((prev) => prev || slackIn.deviceLabel!.trim());
      }
    });
  }, []);

  useEffect(() => {
    setSlackDeviceLabelDraft((prev) => {
      const saved = settings.integrations.slackDeviceLabel?.trim();
      return saved || prev;
    });
  }, [settings.integrations.slackDeviceLabel]);

  useEffect(() => {
    const api = window.sideboard.getSlackListenStatus;
    if (typeof api !== 'function') return;
    const id = window.setInterval(() => {
      void api()
        .then(setSlackListen)
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      void window.sideboard.cancelSlackOAuth?.();
    };
  }, []);

  async function saveSlackDeviceLabel() {
    const label = slackDeviceLabelDraft.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateIntegrationsSettings({
        slackDeviceLabel: label,
      });
      applySettings(next);
      setSlackDeviceLabelDraft(next.integrations.slackDeviceLabel?.trim() || '');
      const listenApi = window.sideboard.getSlackListenStatus;
      if (typeof listenApi === 'function') {
        setSlackListen(await listenApi().catch(() => null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-body">
      <p className="settings-lead">
        Slack remote-controls this Mac. DMs and @mentions go to the Global orchestrator.
      </p>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">Slack</div>
        <p className="settings-hint">
          Click <strong>Add via browser</strong> to install the Sideboard Slack app into a
          workspace. Listening starts automatically. Until the Slack app has{' '}
          <strong>Public Distribution</strong> on, Slack only offers the home workspace (Brightsy)
          — that is a Slack app setting, not a Sideboard picker.
        </p>
        {slackWorkspaces.length > 0 ? (
          <div className="settings-check-list" style={{ marginTop: 10 }}>
            {slackWorkspaces.map((ws) => (
              <div key={ws.team_id} className="settings-toggle-row">
                <div>
                  <p className="settings-status-text">
                    <span
                      className="settings-dot ok"
                      style={{ display: 'inline-block', marginRight: 8 }}
                    />
                    {ws.team_name}
                    <span className="settings-hint"> · {ws.team_id}</span>
                    {!ws.has_user_token ? (
                      <span className="settings-hint"> · search needs user token</span>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || slackOauthBusy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void window.sideboard
                      .disconnectSlackWorkspace(ws.team_id)
                      .then((list) => {
                        setSlackWorkspaces(list);
                        return window.sideboard.getSlackListenStatus?.();
                      })
                      .then((status) => {
                        if (status) setSlackListen(status);
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="settings-hint" style={{ marginTop: 8 }}>
            No workspaces connected yet.
          </p>
        )}
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <input
            type="password"
            value={slackTokenDraft}
            onChange={(e) => setSlackTokenDraft(e.target.value)}
            placeholder="xoxb-… or xoxp-…"
            style={{ flex: 1 }}
            autoComplete="off"
          />
          <button
            type="button"
            className="primary"
            disabled={busy || slackOauthBusy || !slackTokenDraft.trim()}
            onClick={() => {
              setBusy(true);
              setError(null);
              void window.sideboard
                .connectSlackToken(slackTokenDraft.trim())
                .then((list) => {
                  setSlackWorkspaces(list);
                  setSlackTokenDraft('');
                  return window.sideboard.getSlackListenStatus?.();
                })
                .then((status) => {
                  if (status) setSlackListen(status);
                })
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          >
            Add workspace
          </button>
          <button
            type="button"
            disabled={busy || slackOauthBusy}
            onClick={() => {
              setSlackOauthBusy(true);
              setError(null);
              void window.sideboard
                .startSlackOAuth()
                .then((list) => {
                  setSlackWorkspaces(list);
                  return window.sideboard.getSlackListenStatus?.();
                })
                .then((status) => {
                  if (status) setSlackListen(status);
                })
                .catch((err) => {
                  if (isOauthCancelled(err)) return;
                  setError(err instanceof Error ? err.message : String(err));
                })
                .finally(() => setSlackOauthBusy(false));
            }}
          >
            {slackOauthBusy ? 'Waiting for Slack…' : 'Add via browser'}
          </button>
          {slackOauthBusy ? (
            <button
              type="button"
              onClick={() => {
                void window.sideboard.cancelSlackOAuth();
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="settings-section-title">This Mac</div>
          <p className="settings-hint">
            Each MacBook is its own Slack destination. Name this one <strong>Personal</strong> or{' '}
            <strong>Work</strong>. Replies come back as <code>Work: …</code> so you know which Mac
            answered. Address one with <code>work:</code> or <code>personal:</code> at the start of
            the DM (case doesn&apos;t matter).
          </p>
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <input
              value={slackDeviceLabelDraft}
              onChange={(e) => setSlackDeviceLabelDraft(e.target.value)}
              placeholder="Personal"
              style={{ flex: 1 }}
              autoComplete="off"
            />
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                !slackDeviceLabelDraft.trim() ||
                slackDeviceLabelDraft.trim() ===
                  (settings.integrations.slackDeviceLabel?.trim() || '')
              }
              onClick={() => void saveSlackDeviceLabel()}
            >
              Save name
            </button>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="settings-section-title">Listening</div>
          <p className="settings-hint">
            DMs to the bot and @mentions go to the Global orchestrator. Keep Sideboard running.
          </p>
        </div>
        <p className="settings-hint" style={{ marginTop: 8 }}>
          {slackListen?.workspaceCount
            ? slackListen.running
              ? `${
                  slackListen.mode === 'relay' ? 'Relay connected' : 'Listening'
                }${slackListen.deviceLabel ? ` · ${slackListen.deviceLabel}` : ''} · ${slackListen.workspaceCount} workspace${slackListen.workspaceCount === 1 ? '' : 's'}`
              : slackListen.lastError
                ? `Not connected — ${slackListen.lastError}`
                : slackListen.mode
                  ? 'Connecting…'
                  : 'Listen is not available on this Mac yet.'
            : 'Connect a workspace to start listening.'}
        </p>
        {slackListen?.lastLog ? (
          <p className="settings-hint settings-cloud-log">{slackListen.lastLog}</p>
        ) : null}
        <p className="settings-hint" style={{ marginTop: 12 }}>
          Connect a workspace with Add via browser. Listening only receives your Slack user&apos;s
          messages on this Mac.
        </p>
      </div>
    </div>
  );
}
