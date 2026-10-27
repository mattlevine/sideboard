import { useEffect, useState } from 'react';
import type { PublicAppSettings, RelayAccountProvider, RemoteHostStatus } from '@sideboard-ai/core';
import { CursorMark, EntireMark, GitHubMark } from './GitHostMarks';
import { PairingQr } from './PairingQr';

/** Electron IPC prefixes the main-process message and drops `error.cause`. */
function errorText(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*/i, '');
  msg = msg.replace(/^(?:TypeError|Error):\s*/, '');
  return msg;
}

const hostButtonStyle = { display: 'inline-flex', alignItems: 'center', gap: 8 } as const;

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
  const [relayDraft, setRelayDraft] = useState(settings.integrations.remoteRelayUrl ?? '');
  const [signingIn, setSigningIn] = useState<RelayAccountProvider | 'out' | null>(null);
  const [pairing, setPairing] = useState(false);
  const signedIn = Boolean(settings.integrations.hasRemoteAccount);

  useEffect(() => {
    void window.sideboard.getRemoteStatus?.().then(setRemote).catch(() => undefined);
  }, []);

  useEffect(() => {
    setLabelDraft((prev) => settings.integrations.slackDeviceLabel?.trim() || prev);
  }, [settings.integrations.slackDeviceLabel]);

  useEffect(() => {
    setRelayDraft(settings.integrations.remoteRelayUrl ?? '');
  }, [settings.integrations.remoteRelayUrl]);

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
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveRelay() {
    setBusy(true);
    setError(null);
    try {
      const raw = relayDraft.trim();
      const next = await window.sideboard.updateIntegrationsSettings({
        remoteRelayUrl: raw || null,
      });
      applySettings(next);
      setRelayDraft(next.integrations.remoteRelayUrl ?? '');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(provider: RelayAccountProvider) {
    setSigningIn(provider);
    setError(null);
    try {
      const next = await window.sideboard.startRemoteAccountLogin(provider);
      applySettings(next);
    } catch (err) {
      setError(errorText(err));
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
      setError(errorText(err));
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
        Sign in with GitHub, Cursor, or Entire so this Mac can register on the relay. Each
        project keeps its own origin. Repos on this Mac do not have to share a git host.
      </p>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">Relay</div>
        <p className="settings-hint">
          Message text goes through this address. Leave it blank to use Sideboard’s relay.
          To run your own, deploy the relay service (not the website) and paste the same{' '}
          <code>wss://…/remote</code> address here and in the phone app. Saving a different
          relay signs this Mac out.
        </p>
        <div className="settings-key-row" style={{ marginTop: 12 }}>
          <input
            type="text"
            value={relayDraft}
            onChange={(e) => setRelayDraft(e.target.value)}
            placeholder="wss://relay.sideboard.cloud/remote"
            spellCheck={false}
          />
          <button
            type="button"
            disabled={busy || relayDraft.trim() === (settings.integrations.remoteRelayUrl?.trim() || '')}
            onClick={() => void saveRelay()}
          >
            Save relay
          </button>
        </div>
      </div>

      <div className="settings-section settings-section-card">
        <div className="settings-section-title">Relay account</div>
        <p className="settings-hint">
          {signedIn
            ? `Signed in${settings.integrations.remoteAccountEmail ? ` as ${settings.integrations.remoteAccountEmail}` : ''}.`
            : 'Sign in with GitHub, Cursor, or Entire before pairing a phone.'}
        </p>
        <div className="settings-key-row" style={{ marginTop: 12 }}>
          {signedIn ? null : (
            <button
              type="button"
              disabled={busy || signingIn !== null}
              onClick={() => void signIn('github')}
              style={hostButtonStyle}
            >
              <GitHubMark />
              {signingIn === 'github' ? 'Waiting for GitHub…' : 'Sign in with GitHub'}
            </button>
          )}
          {signedIn ? null : (
            <button
              type="button"
              disabled={busy || signingIn !== null}
              onClick={() => void signIn('cursor')}
              style={hostButtonStyle}
            >
              <CursorMark />
              {signingIn === 'cursor' ? 'Waiting for Cursor…' : 'Sign in with Cursor'}
            </button>
          )}
          {signedIn ? null : (
            <button
              type="button"
              disabled={busy || signingIn !== null}
              onClick={() => void signIn('entire')}
              style={hostButtonStyle}
            >
              <EntireMark />
              {signingIn === 'entire' ? 'Waiting for Entire…' : 'Sign in with Entire'}
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
          Scan this code with the Sideboard phone app. It pins this Mac and expires in 10 minutes.
        </p>
        {remote?.pairingCode ? (
          <>
            <PairingQr value={remote.pairingCode} />
            <p className="settings-hint">Paste this line if you can’t scan.</p>
            <input
              readOnly
              value={remote.pairingCode}
              onFocus={(event) => event.currentTarget.select()}
              style={{ width: '100%' }}
            />
          </>
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
