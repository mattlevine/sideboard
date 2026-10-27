import { useEffect, useRef, useState } from 'react';
import type {
  CursorGitStatus,
  EntireGitStatus,
  GitHubStatus,
  GithubGitAuthMode,
  PublicAppSettings,
} from '@sideboard-ai/core';
import { sanitizeGitBranchPrefix } from '@sideboard/branch-prefix';
import { CursorGitCliPanel, EntireGitCliPanel } from './GitHostCliPanels';
import { CursorMark, EntireMark, GitHubMark } from './GitHostMarks';

export type GitSettingsPanel = 'github' | 'cursor' | 'entire';


export function GitSettings({
  settings,
  panel = null,
  onOpenPanel,
  onHostStatus,
  applySettings,
  busy,
  setBusy,
  setError,
}: {
  settings: PublicAppSettings;
  /** Null is the host list, the same shape as Settings → Agents. */
  panel?: GitSettingsPanel | null;
  onOpenPanel?: (panel: GitSettingsPanel) => void;
  onHostStatus?: (status: { github: boolean; cursor: boolean; entire: boolean }) => void;
  applySettings: (next: PublicAppSettings) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}) {
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [cursorStatus, setCursorStatus] = useState<CursorGitStatus | null>(null);
  const [cursorNote, setCursorNote] = useState<string | null>(null);
  const [cursorBusy, setCursorBusy] = useState(false);
  const [entireStatus, setEntireStatus] = useState<EntireGitStatus | null>(null);
  const [entireNote, setEntireNote] = useState<string | null>(null);
  const [entireBusy, setEntireBusy] = useState(false);
  const [githubPatDraft, setGithubPatDraft] = useState('');
  const [showGithubPat, setShowGithubPat] = useState(false);
  const [branchPrefixDraft, setBranchPrefixDraft] = useState(
    settings.advanced?.branchPrefix ?? '',
  );
  const onHostStatusRef = useRef(onHostStatus);
  onHostStatusRef.current = onHostStatus;
  const cursorLoginCancel = useRef(false);
  const entireLoginCancel = useRef(false);

  useEffect(() => {
    setBranchPrefixDraft(settings.advanced?.branchPrefix ?? '');
  }, [settings.advanced?.branchPrefix]);

  useEffect(() => {
    cursorLoginCancel.current = false;
    entireLoginCancel.current = false;
    return () => {
      cursorLoginCancel.current = true;
      entireLoginCancel.current = true;
    };
  }, []);

  async function refreshHosts() {
    const [github, cursor, entire] = await Promise.all([
      window.sideboard.getGitHubStatus().catch(() => null),
      window.sideboard.getCursorGitStatus().catch(() => null),
      window.sideboard.getEntireGitStatus().catch(() => null),
    ]);
    setGithubStatus(github);
    setCursorStatus(cursor);
    setEntireStatus(entire);
  }

  useEffect(() => {
    void refreshHosts();
  }, []);

  useEffect(() => {
    onHostStatusRef.current?.({
      github: Boolean(githubStatus?.connected),
      cursor: Boolean(cursorStatus?.connected),
      entire: Boolean(entireStatus?.connected),
    });
  }, [githubStatus?.connected, cursorStatus?.connected, entireStatus?.connected]);

  async function runCursorLogin() {
    setCursorBusy(true);
    setCursorNote(null);
    setError(null);
    try {
      const result = await window.sideboard.loginCursorGit();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCursorNote(result.message);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !cursorLoginCancel.current) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (cursorLoginCancel.current) return;
        const next = await window.sideboard.getCursorGitStatus().catch(() => null);
        if (next) setCursorStatus(next);
        if (next?.connected) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCursorBusy(false);
    }
  }

  async function runCursorSetupGit() {
    setCursorBusy(true);
    setCursorNote(null);
    setError(null);
    try {
      const result = await window.sideboard.setupCursorGit();
      setCursorNote(result.message);
      if (!result.ok) setError(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCursorBusy(false);
    }
  }

  async function runEntireLogin() {
    setEntireBusy(true);
    setEntireNote(null);
    setError(null);
    try {
      const result = await window.sideboard.loginEntireGit();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setEntireNote(result.message);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !entireLoginCancel.current) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (entireLoginCancel.current) return;
        const next = await window.sideboard.getEntireGitStatus().catch(() => null);
        if (next) setEntireStatus(next);
        if (next?.connected) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEntireBusy(false);
    }
  }

  async function saveIntegrationsPatch(patch: {
    githubGitAuthMode?: GithubGitAuthMode | null;
    githubPat?: string | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      const next = await window.sideboard.updateIntegrationsSettings(patch);
      applySettings(next);
      if ('githubPat' in patch) setGithubPatDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveBranchPrefix(raw: string) {
    const next = raw.trim();
    const current = settings.advanced?.branchPrefix ?? '';
    if (next === current) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await window.sideboard.updateAdvancedSettings({
        branchPrefix: next || '',
      });
      applySettings(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const previewPrefix = sanitizeGitBranchPrefix(branchPrefixDraft);

  return (
    <div className="settings-body">
      <p className="settings-lead">
        {panel === 'cursor'
          ? 'How this Mac signs in to Cursor’s git host (origin.cursor.com). GitHub repos keep using GitHub.'
          : panel === 'entire'
            ? 'How this Mac signs in to Entire (entire.io). Trails replace pull requests on those repos.'
            : panel === 'github'
              ? 'How Sideboard and worktree agents authenticate GitHub on this Mac.'
              : 'Each registered project uses its own git host. Sign-in for GitHub, Cursor, and Entire lives here, the same way each agent has its own options. Branch prefix applies to every host.'}
      </p>

      {!panel ? (
        <div className="settings-agent-list">
          <button
            type="button"
            className="settings-agent-row"
            onClick={() => onOpenPanel?.('github')}
          >
            <span className="settings-agent-mark">
              <GitHubMark />
            </span>
            <div className="settings-agent-copy">
              <div className="settings-agent-name">GitHub</div>
              <div className="settings-agent-meta">
                {githubStatus?.connected
                  ? `Connected${githubStatus.login ? ` · ${githubStatus.login}` : ''}`
                  : githubStatus?.reason || 'Not connected'}
              </div>
            </div>
            <span className={`settings-dot${githubStatus?.connected ? ' ok' : ''}`} />
          </button>
          <button
            type="button"
            className="settings-agent-row"
            onClick={() => onOpenPanel?.('cursor')}
          >
            <span className="settings-agent-mark">
              <CursorMark />
            </span>
            <div className="settings-agent-copy">
              <div className="settings-agent-name">Cursor</div>
              <div className="settings-agent-meta">
                {cursorStatus?.connected
                  ? `Connected${cursorStatus.account ? ` · ${cursorStatus.account}` : ''}`
                  : cursorStatus?.reason || 'Not signed in'}
              </div>
            </div>
            <span className={`settings-dot${cursorStatus?.connected ? ' ok' : ''}`} />
          </button>
          <button
            type="button"
            className="settings-agent-row"
            onClick={() => onOpenPanel?.('entire')}
          >
            <span className="settings-agent-mark">
              <EntireMark />
            </span>
            <div className="settings-agent-copy">
              <div className="settings-agent-name">Entire</div>
              <div className="settings-agent-meta">
                {entireStatus?.connected
                  ? `Connected${entireStatus.account ? ` · ${entireStatus.account}` : ''}`
                  : entireStatus?.reason || 'Not signed in'}
              </div>
            </div>
            <span className={`settings-dot${entireStatus?.connected ? ' ok' : ''}`} />
          </button>
        </div>
      ) : null}

      {panel === 'cursor' ? (
        <CursorGitCliPanel
          status={cursorStatus}
          note={cursorNote}
          busy={cursorBusy}
          onRefresh={() => {
            void refreshHosts().catch((err) =>
              setError(err instanceof Error ? err.message : String(err)),
            );
          }}
          onLogin={() => void runCursorLogin()}
          onSetupGit={() => void runCursorSetupGit()}
        />
      ) : null}

      {panel === 'entire' ? (
        <EntireGitCliPanel
          status={entireStatus}
          note={entireNote}
          busy={entireBusy}
          onRefresh={() => {
            void refreshHosts().catch((err) =>
              setError(err instanceof Error ? err.message : String(err)),
            );
          }}
          onLogin={() => void runEntireLogin()}
        />
      ) : null}
      {panel === 'github' ? (
      <div className="settings-section settings-section-card">
        <div className="settings-toggle-row">
          <div>
            <div className="settings-section-title">GitHub</div>
            <p className="settings-hint">
              The selected mode is injected into agent prompts so they use the same path.
              The connected login also marks your PRs versus ones you are reviewing on the Board
              and in the sidebar — no separate username setting.
            </p>
            {githubStatus?.connected ? (
              <p className="settings-status-text" style={{ marginTop: 8 }}>
                <span
                  className="settings-dot ok"
                  style={{ display: 'inline-block', marginRight: 8 }}
                />
                Connected to {githubStatus.login ?? 'GitHub'}
              </p>
            ) : (
              <p className="settings-hint" style={{ marginTop: 8 }}>
                {githubStatus?.reason ?? 'Not connected'}
              </p>
            )}
          </div>
          <div className="row" style={{ gap: 8, margin: 0 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void window.sideboard
                  .getGitHubStatus()
                  .then(setGithubStatus)
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                void window.sideboard.openExternal('https://cli.github.com/manual/gh_auth_login');
              }}
            >
              Manage
            </button>
          </div>
        </div>
        <div className="settings-mode-list" role="radiogroup" aria-label="GitHub git authentication">
          {(
            [
              {
                id: 'auto' as const,
                title: 'Auto',
                badge: 'Recommended',
                hint: 'HTTPS in the agent process using this Mac’s gh login. Keychain may prompt once at app start; Slack and unattended Cursor turns do not.',
              },
              {
                id: 'gh' as const,
                title: 'gh CLI auth',
                hint: 'Rewrite git@github.com remotes to HTTPS. git/gh use a Sideboard credential file — no GH_TOKEN in the agent, no Keychain after launch.',
              },
              {
                id: 'ssh' as const,
                title: 'SSH',
                hint: 'Keep SSH remotes stored. ask_git / unattended push still use HTTPS via gh when ssh-agent is missing. Batch-mode SSH will not prompt Keychain.',
              },
              {
                id: 'token' as const,
                title: 'Personal access token',
                hint: 'Store a PAT on this Mac. Agents get HTTPS remotes via the same credential file (token is not in their environment).',
              },
            ] satisfies Array<{
              id: GithubGitAuthMode;
              title: string;
              hint: string;
              badge?: string;
            }>
          ).map((opt) => {
            const selected = (settings.integrations.githubGitAuthMode ?? 'auto') === opt.id;
            return (
              <label key={opt.id} className={`settings-mode-option${selected ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="github-git-auth-mode"
                  checked={selected}
                  disabled={busy}
                  onChange={() => void saveIntegrationsPatch({ githubGitAuthMode: opt.id })}
                />
                <div className="settings-mode-option-body">
                  <div className="settings-mode-option-title">
                    {opt.title}
                    {opt.badge ? <span className="settings-badge">{opt.badge}</span> : null}
                  </div>
                  <p className="settings-hint" style={{ marginTop: 4 }}>
                    {opt.hint}
                  </p>
                  {opt.id === 'token' && selected ? (
                    <div className="row" style={{ marginTop: 10, gap: 8 }}>
                      {settings.integrations.hasGithubPat ? (
                        <>
                          <p className="settings-status-text" style={{ flex: 1, margin: 0 }}>
                            Token saved on this Mac
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void saveIntegrationsPatch({ githubPat: null })}
                          >
                            Clear
                          </button>
                        </>
                      ) : (
                        <>
                          <input
                            type={showGithubPat ? 'text' : 'password'}
                            value={githubPatDraft}
                            onChange={(e) => setGithubPatDraft(e.target.value)}
                            placeholder="ghp_… or github_pat_…"
                            style={{ flex: 1 }}
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className="settings-inline-btn"
                            onClick={() => setShowGithubPat((v) => !v)}
                          >
                            {showGithubPat ? 'Hide' : 'Show'}
                          </button>
                          <button
                            type="button"
                            disabled={busy || !githubPatDraft.trim()}
                            onClick={() =>
                              void saveIntegrationsPatch({
                                githubPat: githubPatDraft.trim(),
                              })
                            }
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="settings-inline-btn"
                            onClick={() => {
                              void window.sideboard.openExternal(
                                'https://github.com/settings/tokens/new?scopes=repo,read:org,workflow',
                              );
                            }}
                          >
                            Create token
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      </div>
      ) : null}

      {!panel ? (
      <div className="settings-section settings-section-card">
        <div className="settings-section-title">Branch prefix</div>
        <p className="settings-hint">
          Optional first segment of renamed task branches. Leave empty for no prefix.
        </p>
        <label className="settings-field" style={{ marginTop: 10 }}>
          <input
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={branchPrefixDraft}
            disabled={busy}
            placeholder="none"
            onChange={(e) => setBranchPrefixDraft(e.target.value)}
            onBlur={() => void saveBranchPrefix(branchPrefixDraft)}
          />
        </label>
        <p className="settings-hint" style={{ marginTop: 8 }}>
          Example:{' '}
          <code>
            {previewPrefix
              ? `${previewPrefix}/bb-1234-eng-fix-thing`
              : 'bb-1234-eng-fix-thing'}
          </code>
        </p>
      </div>
      ) : null}
    </div>
  );
}
