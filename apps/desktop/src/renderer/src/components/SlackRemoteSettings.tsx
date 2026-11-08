import { useEffect, useState } from 'react';
import type { SlackListenStatus, SlackWorkspaceInfo } from '@sideboard-ai/core';

function errorText(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, '');
  msg = msg.replace(/^(?:TypeError|Error):\s*/, '');
  return msg;
}

function isOauthCancelled(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel/i.test(msg);
}

export function SlackRemoteSettings({
  busy,
  setBusy,
  setError,
}: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}) {
  const [slackWorkspaces, setSlackWorkspaces] = useState<SlackWorkspaceInfo[]>([]);
  const [slackListen, setSlackListen] = useState<SlackListenStatus | null>(null);
  const [slackTokenDraft, setSlackTokenDraft] = useState('');
  const [slackOauthBusy, setSlackOauthBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      window.sideboard.getSlackWorkspaces().catch(() => [] as SlackWorkspaceInfo[]),
      window.sideboard.getSlackListenStatus().catch(() => null),
    ]).then(([slack, slackIn]) => {
      setSlackWorkspaces(slack);
      setSlackListen(slackIn);
    });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void window.sideboard
        .getSlackListenStatus()
        .then(setSlackListen)
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      void window.sideboard.cancelSlackOAuth?.();
    };
  }, []);

  const locked = busy || slackOauthBusy;

  return (
    <div className="settings-section settings-section-card">
      <div className="settings-section-title">Slack</div>
      <p className="settings-hint">
        Click <strong>Add via browser</strong> to install the Sideboard Slack app into a workspace.
        Each click adds one team and leaves the others connected. Listening starts automatically.
        Until the Slack app has <strong>Public Distribution</strong> on, Slack only offers the home
        workspace (Brightsy) — that is a Slack app setting, not a Sideboard picker.
      </p>
      {slackWorkspaces.length > 0 ? (
        <div className="settings-check-list" style={{ marginTop: 10 }}>
          {slackWorkspaces.map((ws) => (
            <div key={ws.team_id} className="settings-toggle-row">
              <div>
                <p className="settings-status-text">
                  <span className="settings-dot ok" style={{ display: 'inline-block', marginRight: 8 }} />
                  {ws.team_name}
                  <span className="settings-hint"> · {ws.team_id}</span>
                  {!ws.has_user_token ? (
                    <span className="settings-hint"> · reconnect via browser</span>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void window.sideboard
                    .disconnectSlackWorkspace(ws.team_id)
                    .then((list) => {
                      setSlackWorkspaces(list);
                      return window.sideboard.getSlackListenStatus();
                    })
                    .then((status) => {
                      if (status) setSlackListen(status);
                    })
                    .catch((err) => setError(errorText(err)))
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
          disabled={locked || !slackTokenDraft.trim()}
          onClick={() => {
            setBusy(true);
            setError(null);
            void window.sideboard
              .connectSlackToken(slackTokenDraft.trim())
              .then((list) => {
                setSlackWorkspaces(list);
                setSlackTokenDraft('');
                return window.sideboard.getSlackListenStatus();
              })
              .then((status) => {
                if (status) setSlackListen(status);
              })
              .catch((err) => setError(errorText(err)))
              .finally(() => setBusy(false));
          }}
        >
          Add workspace
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            setSlackOauthBusy(true);
            setError(null);
            void window.sideboard
              .startSlackOAuth()
              .then((list) => {
                setSlackWorkspaces(list);
                return window.sideboard.getSlackListenStatus();
              })
              .then((status) => {
                if (status) setSlackListen(status);
              })
              .catch((err) => {
                if (isOauthCancelled(err)) return;
                setError(errorText(err));
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
        <div className="settings-section-title">Listening</div>
        <p className="settings-hint">
          DMs to the bot and @mentions go to the Global orchestrator. Keep Sideboard running.
        </p>
      </div>
      <p className="settings-hint" style={{ marginTop: 8 }}>
        {slackListen?.workspaceCount
          ? slackListen.running
            ? `${slackListen.mode === 'relay' ? 'Relay connected' : 'Listening'}${
                slackListen.deviceLabel ? ` · ${slackListen.deviceLabel}` : ''
              } · ${slackListen.workspaceCount} workspace${slackListen.workspaceCount === 1 ? '' : 's'}`
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
      <div style={{ marginTop: 16 }}>
        <div className="settings-section-title">Community</div>
        <p className="settings-hint">
          Product questions go to the Sideboard community Slack (<code>sideboard-ai.slack.com</code>
          ). Open that URL, enter your email, then the confirmation code Slack sends. That workspace
          is not the same as installing the Sideboard app into your own team with Add via browser.
        </p>
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              void window.sideboard.openExternal('https://sideboard-ai.slack.com');
            }}
          >
            Join community Slack
          </button>
          <button
            type="button"
            onClick={() => {
              void window.sideboard.openExternal('https://www.sideboard.build/support/');
            }}
          >
            How to join
          </button>
        </div>
      </div>
    </div>
  );
}
