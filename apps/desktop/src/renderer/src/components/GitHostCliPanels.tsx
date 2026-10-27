import type { CursorGitStatus, EntireGitStatus } from '@sideboard-ai/core';
import { CursorMark, EntireMark } from './GitHostMarks';

const CURSOR_GIT_DOCS = 'https://cursor.com/docs';
const ENTIRE_GIT_DOCS = 'https://docs.entire.com/quickstart';

function ConnectedDot() {
  return (
    <span className="settings-dot ok" style={{ display: 'inline-block', marginRight: 8 }} />
  );
}

export function CursorGitCliPanel({
  status,
  note,
  busy,
  onRefresh,
  onLogin,
  onSetupGit,
}: {
  status: CursorGitStatus | null;
  note: string | null;
  busy: boolean;
  onRefresh: () => void;
  onLogin: () => void;
  onSetupGit: () => void;
}) {
  const installed = status?.installed !== false;
  return (
    <div className="settings-section settings-section-card">
      <div className="settings-toggle-row">
        <div>
          <div className="settings-section-title">Origin CLI</div>
          <p className="settings-hint">
            Cursor repos use <code>origin</code> the way GitHub repos use <code>gh</code>.
            Log in opens Terminal for <code>origin auth login</code>. Configure git runs{' '}
            <code>origin auth setup-git</code> so pushes to origin.cursor.com authenticate.
            Worktree agents on a Cursor origin are told to use <code>origin pr</code>, not{' '}
            <code>gh</code>.
          </p>
          {status?.connected ? (
            <p className="settings-status-text" style={{ marginTop: 8 }}>
              <ConnectedDot />
              Connected
              {status.account ? ` · ${status.account}` : ''}
              {status.authMethod ? ` · ${status.authMethod}` : ''}
            </p>
          ) : (
            <p className="settings-hint" style={{ marginTop: 8 }}>
              {status?.reason ?? 'Not signed in'}
            </p>
          )}
          {note ? (
            <p className="settings-hint" style={{ marginTop: 8 }}>
              {note}
            </p>
          ) : null}
        </div>
      </div>
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={onRefresh}>
          Refresh
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !installed}
          onClick={onLogin}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <CursorMark />
          {busy ? 'Working…' : 'Log in'}
        </button>
        <button type="button" disabled={busy || !installed} onClick={onSetupGit}>
          Configure git
        </button>
        <button type="button" disabled={busy} onClick={() => void window.sideboard.openExternal(CURSOR_GIT_DOCS)}>
          Docs
        </button>
      </div>
    </div>
  );
}

export function EntireGitCliPanel({
  status,
  note,
  busy,
  onRefresh,
  onLogin,
}: {
  status: EntireGitStatus | null;
  note: string | null;
  busy: boolean;
  onRefresh: () => void;
  onLogin: () => void;
}) {
  return (
    <div className="settings-section settings-section-card">
      <div className="settings-toggle-row">
        <div>
          <div className="settings-section-title">Entire CLI</div>
          <p className="settings-hint">
            Entire repos use <code>entire</code> the way GitHub repos use <code>gh</code>.
            Log in opens Terminal for <code>entire login</code>. That login is what{' '}
            <code>git</code> uses for <code>entire://</code> remotes. Work on an Entire origin
            is a Trail (<code>entire trail</code>), not a GitHub pull request.
          </p>
          {status?.connected ? (
            <p className="settings-status-text" style={{ marginTop: 8 }}>
              <ConnectedDot />
              Connected
              {status.account ? ` · ${status.account}` : ''}
            </p>
          ) : (
            <p className="settings-hint" style={{ marginTop: 8 }}>
              {status?.reason ?? 'Not signed in'}
            </p>
          )}
          {note ? (
            <p className="settings-hint" style={{ marginTop: 8 }}>
              {note}
            </p>
          ) : null}
        </div>
      </div>
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={onRefresh}>
          Refresh
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || status?.installed === false}
          onClick={onLogin}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <EntireMark />
          {busy ? 'Working…' : 'Log in'}
        </button>
        <button type="button" disabled={busy} onClick={() => void window.sideboard.openExternal(ENTIRE_GIT_DOCS)}>
          Docs
        </button>
      </div>
    </div>
  );
}
