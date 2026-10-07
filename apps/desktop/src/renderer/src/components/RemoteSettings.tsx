import { useEffect, useState } from 'react';
import type { PublicAppSettings, RemoteHostStatus } from '@sideboard-ai/core';

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
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
  const [remote, setRemote] = useState<RemoteHostStatus | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [signingIn, setSigningIn] = useState<'github' | 'out' | null>(null);
  const [pairing, setPairing] = useState(false);
  const signedIn = Boolean(settings.integrations.hasRemoteAccount);

  useEffect(() => {
    void window.sideboard.getRemoteStatus?.().then(setRemote).catch(() => undefined);
  }, []);

  useEffect(() => {
    setLabelDraft((prev) => settings.integrations.slackDeviceLabel?.trim() || prev);
  }, [settings.integrations.slackDeviceLabel]);

  useEffect(() => {
    const api = window.sideboard.getRemoteStatus;
    if (typeof api !== 'function') return;
    const id = window.setInterval(() => {
      void api().then(setRemote).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  async function saveLabel() {
    const label = labelDraft.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateIntegrationsSettings({
        slackDeviceLabel: label,
      });
      applySettings(next);
      setLabelDraft(next.integrations.slackDeviceLabel?.trim() || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    setSigningIn('github');
    setError(null);
    try {
      const next = await window.sideboard.startRemoteAccountLogin('github');
      applySettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(null);
    }
  }

  async function signOut() {
    setSigningIn('out');
    setError(null);
    try {
      const next = await window.sideboard.disconnectRemoteAccount();
      applySettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(null);
    }
  }

  const status = remote?.phoneConnected
    ? 'Phone connected'
    : remote?.connected
      ? 'Relay connected'
      : remote?.running
        ? 'Connecting…'
        : 'Remote is off';

  return (
    <div className="settings-body">
      <p className="settings-lead">
        The Sideboard phone app chats with the Global orchestrator on this Mac. Agents stay here.
        Sign in with GitHub, the git host, so this Mac can register on the relay. Other git
        hosts can be added later.
      </p>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">Relay account</div>
        <p className="settings-hint">
          {signedIn
            ? `Signed in${settings.integrations.remoteAccountEmail ? ` as ${settings.integrations.remoteAccountEmail}` : ''}.`
            : 'Sign in with GitHub before pairing a phone.'}
        </p>
        <div className="settings-key-row" style={{ marginTop: 12 }}>
          {signedIn ? null : (
            <button
              type="button"
              disabled={busy || signingIn !== null}
              onClick={() => void signIn()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <GitHubMark />
              {signingIn === 'github' ? 'Waiting for GitHub…' : 'Sign in with GitHub'}
            </button>
          )}
          {signedIn ? (
            <button type="button" disabled={busy || signingIn !== null} onClick={() => void signOut()}>
              {signingIn === 'out' ? 'Signing out…' : 'Sign out'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">This Mac</div>
        <p className="settings-hint">
          Name shown in the phone’s desktop list. A phone can pair with more than one Mac and
          you pick which one to open. Keep Sideboard open. The relay only carries message text.
        </p>
        <p className="settings-status-text" style={{ marginTop: 10 }}>
          <span
            className={`settings-dot ${remote?.connected ? 'ok' : ''}`}
            style={{ display: 'inline-block', marginRight: 8 }}
          />
          {status}
          {remote?.deviceLabel ? <span className="settings-hint"> · {remote.deviceLabel}</span> : null}
        </p>
        {remote?.lastError ? <p className="settings-hint">{remote.lastError}</p> : null}
        <div className="settings-key-row" style={{ marginTop: 12 }}>
          <input
            type="text"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            placeholder="Work"
          />
          <button
            type="button"
            disabled={
              busy ||
              !labelDraft.trim() ||
              labelDraft.trim() === (settings.integrations.slackDeviceLabel?.trim() || '')
            }
            onClick={() => void saveLabel()}
          >
            Save name
          </button>
        </div>
      </div>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">Pair a phone</div>
        <p className="settings-hint">
          Open the Sideboard app on your phone and enter this code. It expires in 10 minutes.
        </p>
        {remote?.pairingCode ? (
          <p className="settings-status-text" style={{ fontSize: 28, letterSpacing: 4 }}>
            {remote.pairingCode}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || pairing || !remote?.connected || !signedIn}
          onClick={() => {
            setPairing(true);
            void window.sideboard
              .requestRemotePairingCode?.()
              .then((next) => {
                if (!next) return;
                setRemote((current) => {
                  if (next.pairingCode || !current?.pairingCode) return next;
                  return { ...next, pairingCode: current.pairingCode };
                });
              })
              .finally(() => setPairing(false));
          }}
        >
          {pairing ? 'Getting code…' : 'Show pairing code'}
        </button>
      </div>
    </div>
  );
}
