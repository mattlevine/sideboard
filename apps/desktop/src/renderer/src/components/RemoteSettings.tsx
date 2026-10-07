import { useEffect, useState } from 'react';
import type { PublicAppSettings, RemoteHostStatus } from '@sideboard-ai/core';

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
            <button type="button" disabled={busy || signingIn !== null} onClick={() => void signIn()}>
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
