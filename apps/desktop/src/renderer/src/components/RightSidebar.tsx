import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DiffResult,
  DiffScope,
  LandPreview,
  PrCheckRun,
  PrDetails,
  Thread,
} from '@sideboard/core';
import { FileTree } from './FileTree';
import { ConfirmDialog } from './ConfirmDialog';
import { DiffLines } from './DiffLines';
import { PrChecksPanel } from './PrChecksPanel';
import { PrReviewPanel } from './PrReviewPanel';
import { ChangesScopeMenu } from './ChangesScopeMenu';
import { closeChatTabMessage } from '../lib/close-chat-tab';
import { AGENT_SETUP_PROMPT } from '../lib/agent-setup-prompt';
import { summarizeChecks } from '../lib/pr-format';
import { parseUnifiedPatch } from '../lib/tool-diff';
import { fileChangeMap, GitChangeBadge } from './GitChangeBadge';

interface Props {
  thread: Thread;
  onRefresh: () => void;
  onAskAboutFile: (path: string) => void;
  openFilePath?: string | null;
  onOpenFile?: (path: string) => void;
  onForkWorktree?: () => void;
  pendingLand?: { draft?: boolean; web?: boolean } | null;
  onPendingLandConsumed?: () => void;
  /** Notify parent so file tabs can show the same git markers. */
  onFileChanges?: (changes: ReturnType<typeof fileChangeMap>) => void;
}

type UpperTab = 'changes' | 'files' | 'checks' | 'review';
type LowerTab = 'setup' | 'run' | 'terminal';

interface RepoSetupInfo {
  hasConfig: boolean;
  hasSetupScript: boolean;
  configLabel: string | null;
}

function prNumber(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/pull\/(\d+)/);
  return m?.[1] ?? null;
}

function isNotGitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('not a git repository') ||
    m.includes('not a git repo') ||
    m.includes('fatal: not a git')
  );
}

function isMissingWorktreeError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('worktree not found') ||
    (m.includes('cwd') && m.includes('enoent')) ||
    m.includes('the "cwd" option is invalid')
  );
}

export function RightSidebar({
  thread,
  onRefresh,
  onAskAboutFile,
  openFilePath = null,
  onOpenFile,
  onForkWorktree,
  pendingLand = null,
  onPendingLandConsumed,
  onFileChanges,
}: Props) {
  const [upper, setUpper] = useState<UpperTab>('files');
  const [lower, setLower] = useState<LowerTab>('run');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffScope, setDiffScope] = useState<DiffScope>('commits');
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [initGitBusy, setInitGitBusy] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [hasHook, setHasHook] = useState(false);
  const [setupInfo, setSetupInfo] = useState<RepoSetupInfo | null>(null);
  const [setupOutput, setSetupOutput] = useState('');
  const [setupRunning, setSetupRunning] = useState(false);
  const [agentSetupBusy, setAgentSetupBusy] = useState(false);
  const setupOutputRef = useRef<HTMLPreElement>(null);
  const [landPreview, setLandPreview] = useState<LandPreview | null>(null);
  const [landOpts, setLandOpts] = useState<{ draft?: boolean; web?: boolean }>({});
  const [prMenuOpen, setPrMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<{ chatCount: number } | null>(null);
  const prMenuRef = useRef<HTMLDivElement>(null);
  const fileSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [prChecks, setPrChecks] = useState<PrCheckRun[] | null>(null);
  const [prDetails, setPrDetails] = useState<PrDetails | null>(null);
  const [prChecksError, setPrChecksError] = useState<string | null>(null);
  const [prDetailsError, setPrDetailsError] = useState<string | null>(null);
  const [prChecksLoading, setPrChecksLoading] = useState(false);
  const [prDetailsLoading, setPrDetailsLoading] = useState(false);

  useEffect(() => {
    void window.sideboard
      .hasConductorHook(thread.worktreePath, thread.repoPath)
      .then(setHasHook);
    void window.sideboard
      .getRepoSetupInfo(thread.worktreePath, thread.repoPath)
      .then(setSetupInfo);
  }, [thread.worktreePath, thread.repoPath, thread.updatedAt]);

  useEffect(() => {
    const off = window.sideboard.onEvent((event) => {
      if (event.threadId !== thread.id) return;
      if (event.type === 'setup_started') {
        setSetupOutput('');
        setSetupRunning(true);
      }
      if (event.type === 'setup_output') {
        setSetupOutput((prev) => (prev ? `${prev}\n${event.line}` : event.line));
      }
      if (event.type === 'setup_finished') {
        setSetupRunning(false);
        void window.sideboard
          .getRepoSetupInfo(thread.worktreePath, thread.repoPath)
          .then(setSetupInfo);
        void window.sideboard
          .hasConductorHook(thread.worktreePath, thread.repoPath)
          .then(setHasHook);
      }
      if (event.type === 'turn_finished') {
        void window.sideboard
          .getRepoSetupInfo(thread.worktreePath, thread.repoPath)
          .then(setSetupInfo);
        void window.sideboard
          .hasConductorHook(thread.worktreePath, thread.repoPath)
          .then(setHasHook);
      }
    });
    return off;
  }, [thread.id, thread.worktreePath, thread.repoPath]);

  useEffect(() => {
    const el = setupOutputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [setupOutput]);

  useEffect(() => {
    if (!prMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!prMenuRef.current?.contains(e.target as Node)) setPrMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [prMenuOpen]);

  const reloadDiff = useCallback(() => {
    let cancelled = false;
    setDiffError(null);
    void window.sideboard
      .getDiff(thread.id, {
        scope: diffScope,
        commitSha: diffScope === 'commits' ? commitSha : null,
      })
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
        // Keep file-tab git markers on the broad change set, not a narrow filter.
        if (
          (diffScope === 'commits' && !commitSha) ||
          diffScope === 'uncommitted'
        ) {
          onFileChanges?.(fileChangeMap(d.files));
        }
        if (upper === 'changes') {
          setSelected((prev) =>
            prev && d.files.some((f) => f.path === prev) ? prev : (d.files[0]?.path ?? null),
          );
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDiff(null);
          setDiffError(err instanceof Error ? err.message : String(err));
          onFileChanges?.({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [thread.id, diffScope, commitSha, upper, onFileChanges]);

  useEffect(() => {
    return reloadDiff();
  }, [thread.id, thread.updatedAt, thread.status, reloadDiff]);

  function onDiffScopeChange(scope: DiffScope, sha?: string | null) {
    setDiffScope(scope);
    setCommitSha(scope === 'commits' ? (sha ?? null) : null);
  }

  useEffect(() => {
    setCommitSha(null);
    setDiffScope('commits');
  }, [thread.id]);

  async function initializeGitRepo() {
    setInitGitBusy(true);
    try {
      await window.sideboard.initializeGit(thread.id);
      setDiffError(null);
      reloadDiff();
      onRefresh();
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitGitBusy(false);
    }
  }

  const changeByPath = useMemo(
    () => (diff ? fileChangeMap(diff.files) : {}),
    [diff],
  );

  useEffect(() => {
    if (upper !== 'files') return;
    let cancelled = false;
    setFilesError(null);
    void window.sideboard
      .listFiles(thread.id)
      .then((files) => {
        if (cancelled) return;
        setAllFiles(files);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFilesError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [thread.id, thread.updatedAt, upper]);

  const loadPrChecks = useCallback(async () => {
    setPrChecksLoading(true);
    setPrChecksError(null);
    try {
      const checks = await window.sideboard.getPrChecks(thread.id);
      setPrChecks(checks);
    } catch (err) {
      setPrChecks(null);
      setPrChecksError(err instanceof Error ? err.message : String(err));
    } finally {
      setPrChecksLoading(false);
    }
  }, [thread.id]);

  const loadPrDetails = useCallback(async () => {
    setPrDetailsLoading(true);
    setPrDetailsError(null);
    try {
      const details = await window.sideboard.getPrDetails(thread.id);
      setPrDetails(details);
      if (details?.checks) setPrChecks(details.checks);
      if (details?.url && details.url !== thread.prUrl) onRefresh();
    } catch (err) {
      setPrDetails(null);
      setPrDetailsError(err instanceof Error ? err.message : String(err));
    } finally {
      setPrDetailsLoading(false);
    }
  }, [thread.id, thread.prUrl, onRefresh]);

  useEffect(() => {
    if (upper !== 'checks') return;
    void loadPrChecks();
  }, [upper, thread.id, thread.prUrl, thread.branchName, thread.updatedAt, loadPrChecks]);

  useEffect(() => {
    if (upper !== 'review') return;
    void loadPrDetails();
  }, [upper, thread.id, thread.prUrl, thread.branchName, thread.updatedAt, loadPrDetails]);

  // Light poll while checks are pending
  useEffect(() => {
    if (upper !== 'checks' && upper !== 'review') return;
    const list = prChecks ?? prDetails?.checks ?? [];
    if (!list.some((c) => c.bucket === 'pending')) return;
    const id = window.setInterval(() => {
      if (upper === 'checks') void loadPrChecks();
      else void loadPrDetails();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [upper, prChecks, prDetails, loadPrChecks, loadPrDetails]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        // Dev start/stop — match Conductor ⌘R
        if (!hasHook && !thread.devPort) return;
        e.preventDefault();
        if (thread.devPort) {
          void window.sideboard.stopDevScript(thread.id).then(onRefresh);
        } else {
          setLower('run');
          void window.sideboard.runDevScript(thread.id).then(onRefresh).catch(alert);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasHook, thread.devPort, thread.id, onRefresh]);

  const changeCount = diff?.files.length ?? 0;

  function focusChangedFile(path: string) {
    setSelected(path);
    onOpenFile?.(path);
    const el = fileSectionRefs.current[path];
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  const num = prNumber(thread.prUrl ?? prDetails?.url ?? null);
  const checksForBadge = prChecks ?? prDetails?.checks ?? null;
  const checksTabLabel = useMemo(() => {
    if (!checksForBadge || checksForBadge.length === 0) return 'Checks';
    const s = summarizeChecks(checksForBadge);
    return s.label ? `Checks ${s.label}` : 'Checks';
  }, [checksForBadge]);

  async function fixCheckWithAgent(check: PrCheckRun) {
    const lines = [
      `Investigate and fix the failing CI check "${check.name}" (${check.state}).`,
      check.workflow ? `Workflow: ${check.workflow}` : null,
      check.description ? `Details: ${check.description}` : null,
      check.link ? `Logs: ${check.link}` : null,
    ].filter(Boolean);
    try {
      await window.sideboard.sendToThread(thread.id, lines.join('\n'));
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function openLand(opts: { draft?: boolean; web?: boolean } = {}) {
    setLandOpts(opts);
    setPrMenuOpen(false);
    setBusy(true);
    try {
      const preview = await window.sideboard.previewLand(thread.id);
      setLandPreview(preview);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runSetupScript() {
    try {
      await window.sideboard.runSetup(thread.id);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function useAgentSetup() {
    if (agentSetupBusy) return;
    setAgentSetupBusy(true);
    try {
      await window.sideboard.sendToThread(thread.id, AGENT_SETUP_PROMPT);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentSetupBusy(false);
    }
  }

  async function toggleDev() {
    setLower('run');
    if (thread.devPort) {
      await window.sideboard.stopDevScript(thread.id);
      onRefresh();
      return;
    }
    try {
      await window.sideboard.runDevScript(thread.id);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (pendingLand === null) return;
    void openLand(pendingLand).finally(() => onPendingLandConsumed?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per pendingLand request
  }, [pendingLand]);

  return (
    <aside className="right-sidebar">
      <div className="right-top">
        <div className="right-top-row">
          {thread.prUrl ? (
            <button
              type="button"
              className="pr-pill"
              onClick={() => void window.sideboard.openExternal(thread.prUrl!)}
              title={thread.prUrl}
            >
              {num ? `#${num}` : 'PR'} ↗
            </button>
          ) : (
            <span className="branch-pill" title={thread.branchName}>
              {thread.branchName.replace(/^thread\//, '')}
            </span>
          )}
          <div className="right-actions">
            {onForkWorktree && (
              <button type="button" className="btn-continue" onClick={onForkWorktree} title="Fork worktree">
                Fork
              </button>
            )}
            <div className="split-btn" ref={prMenuRef}>
              <button
                type="button"
                className="btn-continue split-main"
                disabled={busy}
                onClick={() => void openLand()}
              >
                {thread.prUrl ? 'Continue' : 'Create PR'}
              </button>
              {!thread.prUrl && (
                <>
                  <button
                    type="button"
                    className="btn-continue split-caret"
                    disabled={busy}
                    title="More PR options"
                    onClick={() => setPrMenuOpen((v) => !v)}
                  >
                    ▾
                  </button>
                  {prMenuOpen && (
                    <div className="tool-menu">
                      <button type="button" onClick={() => void openLand({ draft: true })}>
                        <span className="tool-menu-icon">⎇</span>
                        <span>Create draft PR</span>
                      </button>
                      <button type="button" onClick={() => void openLand({ web: true })}>
                        <span className="tool-menu-icon">↗</span>
                        <span>Create PR manually</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              className="primary btn-archive"
              onClick={() => {
                void window.sideboard
                  .listWorktreeChats(thread.id)
                  .then((chats) => setArchiveConfirm({ chatCount: chats.length }))
                  .catch(alert);
              }}
            >
              Archive
            </button>
          </div>
        </div>
      </div>

      <div className="right-upper">
        <div className="right-tabs">
          <button
            type="button"
            className={upper === 'files' ? 'active' : ''}
            onClick={() => setUpper('files')}
          >
            All files
          </button>
          <button
            type="button"
            className={upper === 'changes' ? 'active' : ''}
            onClick={() => setUpper('changes')}
          >
            Changes{changeCount ? ` ${changeCount}` : ''}
          </button>
          <button
            type="button"
            className={upper === 'checks' ? 'active' : ''}
            onClick={() => setUpper('checks')}
          >
            {checksTabLabel}
          </button>
          <button
            type="button"
            className={upper === 'review' ? 'active' : ''}
            onClick={() => setUpper('review')}
          >
            Review
            {prDetails
              ? ` (${prDetails.reviews.length + prDetails.comments.length})`
              : ''}
          </button>
        </div>

        <div className="right-upper-body">
          {upper === 'changes' && (
            <>
              {!diffError || (!isNotGitError(diffError) && !isMissingWorktreeError(diffError)) ? (
                <div className="changes-scope-bar">
                  <ChangesScopeMenu
                    scope={diffScope}
                    commitSha={commitSha}
                    commits={diff?.commits}
                    scopeStats={diff?.scopeStats}
                    hasLastTurnBase={diff?.hasLastTurnBase ?? false}
                    onChange={onDiffScopeChange}
                  />
                </div>
              ) : null}
              {diffError && isNotGitError(diffError) && (
                <div className="empty changes-git-empty">
                  <p>Use a Git repository to track changes</p>
                  <button
                    type="button"
                    className="primary"
                    disabled={initGitBusy}
                    onClick={() => void initializeGitRepo()}
                  >
                    {initGitBusy ? 'Initializing…' : 'Initialize Repository'}
                  </button>
                </div>
              )}
              {diffError && isMissingWorktreeError(diffError) && (
                <div className="empty changes-git-empty">
                  <p>Worktree not found</p>
                  <span className="thread-meta">
                    This thread’s folder is missing, so changes can’t be tracked.
                  </span>
                </div>
              )}
              {diffError &&
                !isNotGitError(diffError) &&
                !isMissingWorktreeError(diffError) && (
                  <div className="empty">{diffError}</div>
                )}
              {!diffError && !diff && <div className="empty">Loading…</div>}
              {diff && diff.files.length === 0 && (
                <div className="empty">
                  {diff.scope === 'last_turn' && !diff.hasLastTurnBase
                    ? 'Run an agent turn to see its changes'
                    : diff.scope === 'staged'
                      ? 'No staged changes'
                      : diff.scope === 'unstaged'
                        ? 'No unstaged changes'
                      : diff.scope === 'uncommitted'
                        ? 'No uncommitted changes'
                        : diff.scope === 'commits' && diff.commitSha
                          ? 'No changes in this commit'
                          : `No changes vs ${diff.base}`}
                </div>
              )}
              {diff && diff.files.length > 0 && (
                <>
                  <div className="right-file-list">
                    {diff.files.map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        className={`right-file${f.path === selected ? ' active' : ''}`}
                        onClick={() => focusChangedFile(f.path)}
                      >
                        <span className="right-file-path">{f.path}</span>
                        <GitChangeBadge
                          change={{
                            status: f.status,
                            additions: f.additions,
                            deletions: f.deletions,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                  <div className="right-diff right-diff-all">
                    {diff.files.map((f) => (
                      <section
                        key={f.path}
                        ref={(el) => {
                          fileSectionRefs.current[f.path] = el;
                        }}
                        className={`right-diff-file${f.path === selected ? ' active' : ''}`}
                      >
                        <div className="right-diff-toolbar">
                          <button
                            type="button"
                            className="right-diff-path"
                            title={f.path}
                            onClick={() => focusChangedFile(f.path)}
                          >
                            {f.path}
                          </button>
                          <div className="right-diff-toolbar-actions">
                            <GitChangeBadge
                              change={{
                                status: f.status,
                                additions: f.additions,
                                deletions: f.deletions,
                              }}
                            />
                            <button type="button" onClick={() => onAskAboutFile(f.path)}>
                              Ask agent
                            </button>
                          </div>
                        </div>
                        <DiffLines
                          className="tool-diff-body right-diff-lines"
                          rows={parseUnifiedPatch(f.patch || '')}
                        />
                      </section>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {upper === 'files' && (
            <>
              <div className="right-file-filter">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter files…"
                />
                <span className="thread-meta">
                  {allFiles ? `${allFiles.length}` : '…'}
                </span>
              </div>
              <div className="worktree-path-bar" title={thread.worktreePath}>
                Worktree · {thread.worktreePath}
              </div>
              {filesError && <div className="empty">{filesError}</div>}
              {!filesError && !allFiles && <div className="empty">Loading files…</div>}
              {allFiles && allFiles.length === 0 && <div className="empty">No tracked files</div>}
              {allFiles && allFiles.length > 0 && (
                <div className="right-file-list tall tree-scroll tree-fill">
                  <FileTree
                    paths={allFiles}
                    selected={openFilePath}
                    filter={filter}
                    onSelect={(path) => onOpenFile?.(path)}
                    changes={changeByPath}
                  />
                </div>
              )}
            </>
          )}

          {upper === 'checks' && (
            <PrChecksPanel
              checks={prChecks}
              error={prChecksError}
              prUrl={thread.prUrl ?? prDetails?.url ?? null}
              loading={prChecksLoading}
              onRefresh={() => void loadPrChecks()}
              onFixWithAgent={(check) => void fixCheckWithAgent(check)}
            />
          )}

          {upper === 'review' && (
            <PrReviewPanel
              details={prDetails}
              error={prDetailsError}
              prUrl={thread.prUrl ?? prDetails?.url ?? null}
              loading={prDetailsLoading}
              onRefresh={() => void loadPrDetails()}
              onFixWithAgent={(check) => void fixCheckWithAgent(check)}
            />
          )}
        </div>
      </div>

      <div className="right-lower">
        <div className="right-tabs lower-tabs">
          <button
            type="button"
            className={lower === 'setup' ? 'active' : ''}
            onClick={() => setLower('setup')}
          >
            Setup
          </button>
          <button
            type="button"
            className={lower === 'run' ? 'active' : ''}
            onClick={() => setLower('run')}
          >
            Run
          </button>
          <button
            type="button"
            className={lower === 'terminal' ? 'active' : ''}
            onClick={() => setLower('terminal')}
          >
            Terminal
          </button>
          <div className="lower-tab-actions">
            {(thread.status === 'running' || thread.status === 'queued') && (
              <button
                type="button"
                className="chip danger active"
                onClick={() => void window.sideboard.stopThread(thread.id).then(onRefresh)}
              >
                Stop agent
              </button>
            )}
            <button
              type="button"
              className={`dev-composite${thread.devPort ? ' running' : ''}`}
              disabled={!hasHook && !thread.devPort}
              title={thread.devPort ? 'Stop Dev (⌘R)' : 'Start Dev (⌘R)'}
              onClick={() => void toggleDev()}
            >
              <span className="dev-play">{thread.devPort ? '■' : '▶'}</span>
              <span>Dev</span>
              {thread.devPort ? <span className="dev-port">:{thread.devPort}</span> : null}
              <kbd>⌘R</kbd>
            </button>
          </div>
        </div>

        <div className="right-lower-body">
          {lower === 'setup' && (
            <div className="setup-panel">
              {!setupInfo ? (
                <div className="empty">Loading setup…</div>
              ) : !setupInfo.hasConfig ? (
                <>
                  <div className="setup-empty-title">No setup configured</div>
                  <p className="thread-meta setup-empty-copy">
                    This worktree has no <code>.sideboard/settings.toml</code> or{' '}
                    <code>.conductor/settings.toml</code>. Use an agent (in this worktree) to
                    explore the project and create the setup config so Dev (⌘R) works.
                  </p>
                  <p className="thread-meta worktree-path-inline" title={thread.worktreePath}>
                    {thread.worktreePath}
                  </p>
                  <div className="setup-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={agentSetupBusy || thread.status === 'running' || thread.status === 'queued'}
                      onClick={() => void useAgentSetup()}
                    >
                      {agentSetupBusy ? 'Starting agent…' : 'Use agent to set up'}
                    </button>
                  </div>
                  <p className="thread-meta setup-footnote">
                    Or add <code>.sideboard/settings.toml</code> in this worktree — see the Sideboard
                    README.
                  </p>
                </>
              ) : (
                <>
                  <p className="thread-meta setup-config-label">
                    {setupInfo.configLabel}
                    {setupInfo.hasSetupScript ? '' : ' — no setup script defined'}
                  </p>
                  <p className="thread-meta worktree-path-inline" title={thread.worktreePath}>
                    Runs in {thread.worktreePath}
                  </p>
                  <pre
                    ref={setupOutputRef}
                    className={`setup-output${setupOutput ? ' has-output' : ''}`}
                  >
                    {setupOutput ||
                      (setupRunning
                        ? 'Running setup…'
                        : 'No setup script output\n\nSetup script output will appear here after running setup.')}
                  </pre>
                  <div className="setup-actions">
                    {setupInfo.hasSetupScript ? (
                      <button
                        type="button"
                        className="primary"
                        disabled={setupRunning}
                        onClick={() => void runSetupScript()}
                      >
                        {setupRunning ? 'Running setup…' : 'Run setup'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        disabled={agentSetupBusy || thread.status === 'running' || thread.status === 'queued'}
                        onClick={() => void useAgentSetup()}
                      >
                        Use agent to add setup script
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {lower === 'run' && (
            <div className="run-panel">
              {(thread.status === 'running' || thread.status === 'queued') && (
                <div className="run-agent-bar">
                  <span className="thread-meta">Agent {thread.status}</span>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void window.sideboard.stopThread(thread.id).then(onRefresh)}
                  >
                    Stop
                  </button>
                </div>
              )}
              {thread.devPort ? (
                <>
                  <div className="run-hero">▶</div>
                  <div className="run-hero-label">Dev :{thread.devPort}</div>
                  <p className="thread-meta worktree-path-inline" title={thread.worktreePath}>
                    {thread.worktreePath}
                  </p>
                  <div className="row" style={{ justifyContent: 'center', marginBottom: 0 }}>
                    <button
                      type="button"
                      className="primary"
                      onClick={() =>
                        void navigator.clipboard?.writeText(`http://localhost:${thread.devPort}`)
                      }
                    >
                      Copy URL
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void window.sideboard.stopDevScript(thread.id).then(onRefresh)
                      }
                    >
                      Stop Dev
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="run-hero">▶</div>
                  <button
                    type="button"
                    className="primary run-start"
                    disabled={!hasHook}
                    onClick={() => void toggleDev()}
                  >
                    Start Dev
                  </button>
                  <p className="thread-meta">
                    {hasHook
                      ? 'Test your changes in this worktree. ⌘R to start.'
                      : 'Add a run script in this worktree’s settings.toml'}
                  </p>
                  <p className="thread-meta worktree-path-inline" title={thread.worktreePath}>
                    {thread.worktreePath}
                  </p>
                </>
              )}
            </div>
          )}

          {lower === 'terminal' && (
            <div className="run-panel">
              <p className="thread-meta">Open a shell in this worktree.</p>
              <p className="thread-meta worktree-path-inline" title={thread.worktreePath}>
                {thread.worktreePath}
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => void window.sideboard.openWorktree(thread.id, 'terminal')}
              >
                Open Terminal
              </button>
            </div>
          )}
        </div>
      </div>

      {landPreview && (
        <div className="modal-backdrop" onClick={() => setLandPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {thread.prUrl
                ? 'Update land'
                : landOpts.draft
                  ? 'Draft PR preview'
                  : landOpts.web
                    ? 'Manual PR preview'
                    : 'Land preview'}
            </h3>
            <p>
              <strong>{landPreview.branch}</strong> → {landPreview.target}
            </p>
            <p>Dirty: {landPreview.dirty ? 'yes (will auto-commit)' : 'no'}</p>
            <pre className="diff-view" style={{ maxHeight: 200 }}>
              {landPreview.diffStat}
            </pre>
            {landPreview.blocked && (
              <p style={{ color: 'var(--err)' }}>{landPreview.blockReason}</p>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setLandPreview(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={landPreview.blocked}
                onClick={() =>
                  void window.sideboard
                    .confirmLand(thread.id, landOpts)
                    .then((r) => {
                      if (r.prUrl) alert(`PR: ${r.prUrl}`);
                      setLandPreview(null);
                      onRefresh();
                    })
                    .catch((err: unknown) =>
                      alert(err instanceof Error ? err.message : String(err)),
                    )
                }
              >
                {landOpts.web ? 'Push & open' : landOpts.draft ? 'Push & draft PR' : 'Push & PR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveConfirm && (
        <ConfirmDialog
          title="Close chat tab?"
          message={closeChatTabMessage(thread.title, archiveConfirm.chatCount)}
          confirmLabel="Close tab"
          onConfirm={() => {
            setArchiveConfirm(null);
            void window.sideboard.archiveThread(thread.id).then(onRefresh).catch(alert);
          }}
          onCancel={() => setArchiveConfirm(null)}
        />
      )}
    </aside>
  );
}
