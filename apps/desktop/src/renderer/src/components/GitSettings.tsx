import { useEffect, useState } from 'react';
import type { GitHubStatus, GithubGitAuthMode, PublicAppSettings } from '@sideboard-ai/core';

export function GitSettings({
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
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [githubPatDraft, setGithubPatDraft] = useState('');
  const [showGithubPat, setShowGithubPat] = useState(false);

  useEffect(() => {
    void window.sideboard
      .getGitHubStatus()
      .then(setGithubStatus)
      .catch(() => setGithubStatus(null));
  }, []);

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

  return (
    <div className="settings-body">
      <p className="settings-lead">
        How Sideboard and worktree agents authenticate git on this Mac.
      </p>

      <div className="settings-section settings-section-card">
        <div className="settings-toggle-row">
          <div>
            <div className="settings-section-title">GitHub</div>
            <p className="settings-hint">
              The selected mode is injected into agent prompts so they use the same path.
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
                hint: 'Keep SSH remotes. Batch-mode only — will not prompt Keychain. Slack/Cursor fail if ssh-agent is locked.',
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
    </div>
  );
}
