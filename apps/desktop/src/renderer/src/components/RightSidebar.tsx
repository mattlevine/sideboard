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
import { MergeModal } from './MergeModal';
import { PrChecksPanel } from './PrChecksPanel';
import { PrReviewPanel } from './PrReviewPanel';
import { ChangesScopeMenu } from './ChangesScopeMenu';
import { closeChatTabMessage } from '../lib/close-chat-tab';
import { AGENT_SETUP_PROMPT } from '../lib/agent-setup-prompt';
import { summarizeChecks } from '../lib/pr-format';
import { fileChangeMap, GitChangeBadge } from './GitChangeBadge';
import { EmbeddedTerminal } from './EmbeddedTerminal';
import { RunScriptIcon, scriptDisplayName } from '../lib/run-script-icons';

interface Props {
  thread: Thread;
  onRefresh: () => void;
  onAskAboutFile: (path: string) => void;
  openFilePath?: string | null;
  /** Path selected in the dedicated Changes center tab. */
  changesPath?: string | null;
  onOpenFile?: (path: string, opts?: { view?: 'edit' | 'diff' }) => void;
  onForkWorktree?: () => void;
  /** Select another chat tab in this worktree (e.g. after creating one for setup). */
  onSelectChat?: (id: string, created?: Thread) => void;
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

interface RunScriptInfo {
  name: string;
  command: string;
  default?: boolean;
  icon?: string;
}

/** Prefer explicit default, then `dev`, and never fall back to `all`. */
function pickDefaultRunScript(scripts: RunScriptInfo[]): RunScriptInfo | null {
  if (!scripts.length) return null;
  return (
    scripts.find((s) => s.default === true) ??
    scripts.find((s) => s.name === 'dev') ??
    scripts.find((s) => s.name !== 'all') ??
    scripts[0] ??
    null
  );
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
  changesPath = null,
  onOpenFile,
  onForkWorktree,
  onSelectChat,
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
  const [runScripts, setRunScripts] = useState<RunScriptInfo[]>([]);
  const [runLogs, setRunLogs] = useState<Record<string, string>>({});
  const [landPreview, setLandPreview] = useState<LandPreview | null>(null);
  const [landOpts, setLandOpts] = useState<{ draft?: boolean; web?: boolean }>({});
  const [landBusy, setLandBusy] = useState(false);
  const [landError, setLandError] = useState<string | null>(null);
  const [prMenuOpen, setPrMenuOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<{ chatCount: number } | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const prMenuRef = useRef<HTMLDivElement>(null);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const [prChecks, setPrChecks] = useState<PrCheckRun[] | null>(null);
  const [prChecksError, setPrChecksError] = useState<string | null>(null);
  const [prChecksLoading, setPrChecksLoading] = useState(false);
  const [prDetails, setPrDetails] = useState<PrDetails | null>(null);
  const [prDetailsError, setPrDetailsError] = useState<string | null>(null);
  const [prDetailsLoading, setPrDetailsLoading] = useState(false);
  /** Live GitHub PR state for the action bar (OPEN / MERGED / CLOSED). */
  const [prMeta, setPrMeta] = useState<{
    number: number;
    url: string;
    state: string;
    isDraft: boolean;
    title: string;
    baseRefName: string;
  } | null>(null);

  const reloadRunScripts = useCallback(() => {
    if (typeof window.sideboard.listRunScripts !== 'function') {
      setRunScripts([]);
      return;
    }
    void window.sideboard
      .listRunScripts(thread.id)
      .then(setRunScripts)
      .catch(() => setRunScripts([]));
  }, [thread.id]);

  useEffect(() => {
    void window.sideboard
      .hasConductorHook(thread.worktreePath, thread.repoPath)
      .then(setHasHook);
    void window.sideboard
      .getRepoSetupInfo(thread.worktreePath, thread.repoPath)
      .then(setSetupInfo);
    reloadRunScripts();
  }, [thread.worktreePath, thread.repoPath, thread.updatedAt, thread.id, reloadRunScripts]);

  useEffect(() => {
    const off = window.sideboard.onEvent((event) => {
      if ('threadId' in event && event.threadId !== thread.id) return;
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
        reloadRunScripts();
      }
      if (event.type === 'run_output') {
        setRunLogs((prev) => {
          const cur = prev[event.scriptName] ?? '';
          return {
            ...prev,
            [event.scriptName]: cur ? `${cur}\n${event.line}` : event.line,
          };
        });
      }
      if (event.type === 'dev_server_started' || event.type === 'dev_server_stopped') {
        onRefresh();
      }
      if (event.type === 'turn_finished') {
        void window.sideboard
          .getRepoSetupInfo(thread.worktreePath, thread.repoPath)
          .then(setSetupInfo);
        void window.sideboard
          .hasConductorHook(thread.worktreePath, thread.repoPath)
          .then(setHasHook);
        reloadRunScripts();
      }
    });
    return off;
  }, [thread.id, thread.worktreePath, thread.repoPath, onRefresh, reloadRunScripts]);

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

  useEffect(() => {
    if (!runMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!runMenuRef.current?.contains(e.target as Node)) setRunMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [runMenuOpen]);

  useEffect(() => {
    setRunMenuOpen(false);
  }, [thread.id, lower]);

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
      if (details) {
        setPrMeta({
          number: details.number,
          url: details.url,
          state: details.state,
          isDraft: details.isDraft,
          title: details.title,
          baseRefName: details.baseRefName,
        });
      }
    } catch (err) {
      setPrDetails(null);
      setPrDetailsError(err instanceof Error ? err.message : String(err));
    } finally {
      setPrDetailsLoading(false);
    }
  }, [thread.id]);

  const loadPrMeta = useCallback(async () => {
    try {
      const details = await window.sideboard.getPrDetails(thread.id);
      if (!details) {
        setPrMeta(null);
        return;
      }
      setPrMeta({
        number: details.number,
        url: details.url,
        state: details.state,
        isDraft: details.isDraft,
        title: details.title,
        baseRefName: details.baseRefName,
      });
    } catch {
      setPrMeta(null);
    }
  }, [thread.id]);

  useEffect(() => {
    void loadPrMeta();
  }, [loadPrMeta, thread.prUrl, thread.branchName, thread.updatedAt]);

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
        if (!hasHook && !thread.devPort && !(thread.activeRuns?.length)) return;
        e.preventDefault();
        const primary =
          runScripts.find((s) => s.default === true)?.name ??
          runScripts.find((s) => s.name === 'dev')?.name ??
          runScripts.find((s) => s.name !== 'all')?.name ??
          runScripts[0]?.name;
        const primaryIsRunning = primary
          ? (thread.activeRuns ?? []).some((r) => r.scriptName === primary)
          : thread.devPort != null;
        if (primaryIsRunning) {
          void window.sideboard
            .stopDevScript(thread.id, primary)
            .then(onRefresh);
        } else {
          setLower('run');
          void window.sideboard
            .runDevScript(thread.id, primary)
            .then(onRefresh)
            .catch(alert);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasHook, thread.devPort, thread.activeRuns, thread.id, onRefresh, runScripts]);

  const changeCount = diff?.files.length ?? 0;

  function focusChangedFile(path: string) {
    setSelected(path);
    onOpenFile?.(path, { view: 'diff' });
  }

  const prUrl = prMeta?.url ?? thread.prUrl ?? null;
  const num = prMeta?.number != null ? String(prMeta.number) : prNumber(prUrl);
  const prState = (prMeta?.state ?? '').toUpperCase();
  const prMerged = prState === 'MERGED';
  const prClosed = prState === 'CLOSED';
  const prOpen = Boolean(prUrl) && !prMerged && !prClosed;
  const prDraft = Boolean(prMeta?.isDraft) && prOpen;
  /** Local work that still needs to land before merge. */
  const hasLocalChanges =
    Boolean(diff?.dirty) || (diff?.unpushed ?? 0) > 0;

  function primaryGitLabel(): string {
    if (prMerged) return 'Live';
    if (prClosed) return 'Closed';
    if (!prUrl) return 'Create PR';
    if (hasLocalChanges) return 'Commit & push';
    return 'Merge';
  }

  function onPrimaryGitClick() {
    if (prMerged || prClosed) {
      if (prUrl) void window.sideboard.openExternal(prUrl);
      return;
    }
    if (prUrl && !hasLocalChanges) {
      setMergeError(null);
      setMergeConfirm(true);
      return;
    }
    void openLand();
  }

  async function confirmMergePr() {
    if (mergeBusy) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      const result = await window.sideboard.mergePr(thread.id);
      setMergeConfirm(false);
      setPrMeta((prev) =>
        prev
          ? {
              ...prev,
              state: result.state || 'MERGED',
              url: result.url || prev.url,
              isDraft: false,
            }
          : {
              number: Number(num) || 0,
              url: result.url || prUrl || '',
              state: result.state || 'MERGED',
              isDraft: false,
              title: thread.prTitle ?? thread.title,
              baseRefName: 'main',
            },
      );
      onRefresh();
      void loadPrMeta();
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setMergeBusy(false);
    }
  }

  const checksForBadge = prChecks ?? prDetails?.checks ?? null;
  const checksTabLabel = useMemo(() => {
    if (!checksForBadge || checksForBadge.length === 0) return 'Checks';
    const s = summarizeChecks(checksForBadge);
    return s.label ? `Checks ${s.label}` : 'Checks';
  }, [checksForBadge]);

  async function fixCheckWithAgent(check: PrCheckRun) {
    const kind = check.kind ?? 'ci';
    let lines: string[];
    if (kind === 'mergeability') {
      lines = [
        check.state.toUpperCase() === 'BEHIND'
          ? `This pull request is behind its base branch (${check.state}). Update the branch (merge or rebase from the base), resolve any conflicts, and push so the PR can merge.`
          : `This pull request has a mergeability problem (${check.state}). ${check.description ?? 'Resolve merge conflicts with the base branch, commit the resolution, and push.'}`,
        'Inspect the conflicting files, fix them carefully, and leave the branch in a clean mergeable state.',
        check.link ? `PR: ${check.link}` : null,
      ].filter(Boolean) as string[];
    } else if (kind === 'review') {
      lines = [
        `Code review is blocking merge (${check.state}). ${check.description ?? ''}`,
        'Read the PR review comments, address the requested changes, and push updates.',
        check.link ? `PR: ${check.link}` : null,
      ].filter(Boolean) as string[];
    } else {
      lines = [
        `Investigate and fix the failing CI check "${check.name}" (${check.state}).`,
        check.workflow ? `Workflow: ${check.workflow}` : null,
        check.description ? `Details: ${check.description}` : null,
        check.link ? `Logs: ${check.link}` : null,
      ].filter(Boolean) as string[];
    }
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
    setLandError(null);
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

  async function confirmLandPush() {
    if (!landPreview || landPreview.blocked || landBusy) return;
    setLandBusy(true);
    setLandError(null);
    try {
      const result = await window.sideboard.confirmLand(thread.id, landOpts);
      setLandPreview(null);
      onRefresh();
      void loadPrMeta();
      if (result.prUrl) {
        void window.sideboard.openExternal(result.prUrl);
      }
    } catch (err) {
      setLandError(err instanceof Error ? err.message : String(err));
    } finally {
      setLandBusy(false);
    }
  }

  function landTitle() {
    if (thread.prUrl) return 'Update pull request?';
    if (landOpts.draft) return 'Create draft pull request?';
    if (landOpts.web) return 'Push and open GitHub?';
    return 'Create pull request?';
  }

  function landConfirmLabel() {
    if (landBusy) return 'Pushing…';
    if (landOpts.web) return 'Push & open';
    if (landOpts.draft) return 'Push & draft PR';
    if (thread.prUrl) return 'Push & update';
    return 'Push & create PR';
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
      const agentBusy = thread.status === 'running' || thread.status === 'queued';
      let targetId = thread.id;
      if (agentBusy) {
        // Don't interrupt the active turn — open a sibling chat in this worktree.
        const tab = await window.sideboard.createChatTab({
          fromThreadId: thread.id,
          title: 'Setup',
        });
        targetId = tab.id;
        onSelectChat?.(tab.id, tab);
      }
      await window.sideboard.sendToThread(targetId, AGENT_SETUP_PROMPT);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentSetupBusy(false);
    }
  }

  const defaultRunScript = pickDefaultRunScript(runScripts);
  const primaryScriptName =
    defaultRunScript?.name ??
    thread.activeRuns?.[0]?.scriptName ??
    null;
  const primaryRunning = primaryScriptName
    ? (thread.activeRuns ?? []).some((r) => r.scriptName === primaryScriptName)
    : thread.devPort != null;
  const primaryPort =
    (primaryScriptName
      ? thread.activeRuns?.find((r) => r.scriptName === primaryScriptName)?.port
      : null) ??
    thread.devPort ??
    thread.activeRuns?.[0]?.port ??
    null;

  async function toggleDev() {
    setLower('run');
    // Main button only starts/stops the default script — never every script.
    if (primaryRunning) {
      await window.sideboard.stopDevScript(
        thread.id,
        primaryScriptName ?? undefined,
      );
      onRefresh();
      return;
    }
    if (!defaultRunScript) {
      void openRunConfig();
      return;
    }
    try {
      setRunLogs((prev) => ({ ...prev, [defaultRunScript.name]: '' }));
      await window.sideboard.runDevScript(thread.id, defaultRunScript.name);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleNamedScript(name: string) {
    setLower('run');
    if (typeof window.sideboard.runDevScript !== 'function') {
      window.alert('Restart Sideboard to pick up the latest Run script APIs.');
      return;
    }
    const active = (thread.activeRuns ?? []).some((r) => r.scriptName === name);
    try {
      if (active) {
        await window.sideboard.stopDevScript(thread.id, name);
      } else {
        setRunLogs((prev) => ({ ...prev, [name]: '' }));
        await window.sideboard.runDevScript(thread.id, name);
      }
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function openRunConfig() {
    // Prefer worktree settings (agent may have edited them), then main repo.
    const candidates = [
      '.sideboard/settings.toml',
      '.conductor/settings.toml',
    ];
    for (const rel of candidates) {
      try {
        const file = await window.sideboard.readFile(thread.id, rel);
        if (!file.binary) {
          await window.sideboard.openInEditor(thread.id, undefined, rel);
          return;
        }
      } catch {
        // try next
      }
    }
    // No config yet — ask an agent to create one.
    void useAgentSetup();
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
          {prUrl ? (
            <button
              type="button"
              className={`pr-pill${prMerged ? ' merged' : ''}${prClosed ? ' closed' : ''}${prDraft ? ' draft' : ''}`}
              onClick={() => void window.sideboard.openExternal(prUrl)}
              title={prUrl}
            >
              {num ? `#${num}` : 'PR'} ↗
              {prMerged && <span className="pr-status">Merged</span>}
              {prClosed && <span className="pr-status">Closed</span>}
              {prDraft && <span className="pr-status">Draft</span>}
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
                className={`${prMerged ? 'btn-live' : prClosed ? 'btn-closed' : 'btn-continue'} split-main`}
                disabled={busy || mergeBusy}
                onClick={onPrimaryGitClick}
                title={
                  prMerged
                    ? 'Pull request merged — open on GitHub'
                    : prClosed
                      ? 'Pull request closed — open on GitHub'
                      : prUrl && !hasLocalChanges
                        ? 'Merge pull request on GitHub'
                        : prUrl
                          ? 'Commit local changes and push to the pull request'
                          : undefined
                }
              >
                {primaryGitLabel()}
              </button>
              {!prMerged && !prClosed && (
                <>
                  <button
                    type="button"
                    className="btn-continue split-caret"
                    disabled={busy || mergeBusy}
                    title="More PR options"
                    onClick={() => setPrMenuOpen((v) => !v)}
                  >
                    ▾
                  </button>
                  {prMenuOpen && (
                    <div className="tool-menu">
                      {prUrl ? (
                        <>
                          {hasLocalChanges ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPrMenuOpen(false);
                                setMergeError(null);
                                setMergeConfirm(true);
                              }}
                            >
                              <span className="tool-menu-icon">⌥</span>
                              <span>Merge without pushing</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setPrMenuOpen(false);
                                void openLand();
                              }}
                            >
                              <span className="tool-menu-icon">↑</span>
                              <span>Commit & push</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => void openLand({ draft: true })}>
                            <span className="tool-menu-icon">⎇</span>
                            <span>Create draft PR</span>
                          </button>
                          <button type="button" onClick={() => void openLand({ web: true })}>
                            <span className="tool-menu-icon">↗</span>
                            <span>Create PR manually</span>
                          </button>
                        </>
                      )}
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
                <div className="right-file-list changes-file-list">
                  {diff.files.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      className={`right-file${f.path === selected || f.path === changesPath || f.path === openFilePath ? ' active' : ''}`}
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
              prUrl={prUrl}
              loading={prChecksLoading}
              onRefresh={() => void loadPrChecks()}
              onFixWithAgent={(check) => void fixCheckWithAgent(check)}
            />
          )}

          {upper === 'review' && (
            <PrReviewPanel
              details={prDetails}
              error={prDetailsError}
              prUrl={prUrl}
              loading={prDetailsLoading}
              onRefresh={() => void loadPrDetails()}
            />
          )}
        </div>
      </div>

      <div className="right-lower">
        <div className="right-tabs lower-tabs">
          <div className="lower-tabs-scroll">
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
          </div>
          <div className="lower-tab-actions" ref={runMenuRef}>
            {/* Conductor: Open is pinned with Stop/Dev, not in the scrolling tabs. */}
            {lower === 'run' && primaryPort != null ? (
              <button
                type="button"
                className="dev-open-port"
                title={`Open http://localhost:${primaryPort}`}
                onClick={() =>
                  void window.sideboard.openExternal(
                    `http://localhost:${primaryPort}`,
                  )
                }
              >
                <RunScriptIcon name="globe" />
                <span>{`Open :${primaryPort}`}</span>
              </button>
            ) : null}
            {primaryRunning ? (
              <button
                type="button"
                className="dev-stop-btn"
                title={`Stop ${scriptDisplayName(primaryScriptName ?? 'Dev')} (⌘R)`}
                onClick={() => {
                  setRunMenuOpen(false);
                  void toggleDev();
                }}
              >
                <RunScriptIcon name="stop" />
                <span>Stop</span>
                <kbd>⌘R</kbd>
              </button>
            ) : (
              <div className="dev-composite-group">
                <button
                  type="button"
                  className="dev-composite"
                  disabled={!hasHook && runScripts.length === 0}
                  title={
                    defaultRunScript
                      ? `Start ${scriptDisplayName(defaultRunScript.name)} (⌘R)`
                      : 'Configure run scripts'
                  }
                  onClick={() => {
                    setRunMenuOpen(false);
                    void toggleDev();
                  }}
                >
                  <RunScriptIcon name={defaultRunScript?.icon ?? 'play'} />
                  <span>
                    {defaultRunScript
                      ? scriptDisplayName(defaultRunScript.name)
                      : 'Dev'}
                  </span>
                  <kbd>⌘R</kbd>
                </button>
                <button
                  type="button"
                  className={`dev-script-chevron${runMenuOpen ? ' open' : ''}`}
                  title="Run scripts"
                  aria-haspopup="menu"
                  aria-expanded={runMenuOpen}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    reloadRunScripts();
                    setRunMenuOpen((open) => !open);
                  }}
                >
                  ▾
                </button>
              </div>
            )}

            {/* Conductor Terminal is Stop-only; script picker stays on Run. */}
            {primaryRunning && lower === 'run' ? (
              <div className="dev-script-menu standalone">
                <button
                  type="button"
                  className={`dev-script-menu-btn${runMenuOpen ? ' open' : ''}`}
                  title="Run scripts"
                  aria-haspopup="menu"
                  aria-expanded={runMenuOpen}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    reloadRunScripts();
                    setRunMenuOpen((open) => !open);
                  }}
                >
                  ▾
                </button>
              </div>
            ) : null}

            {runMenuOpen ? (
              <ul className="dev-script-dropdown" role="menu">
                {runScripts.length === 0 ? (
                  <li className="dev-script-empty">No run scripts configured</li>
                ) : (
                  runScripts.map((script) => {
                    const active = (thread.activeRuns ?? []).some(
                      (r) => r.scriptName === script.name,
                    );
                    return (
                      <li key={script.name} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          className={active ? 'active' : ''}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setRunMenuOpen(false);
                            void toggleNamedScript(script.name);
                          }}
                        >
                          <RunScriptIcon
                            name={active ? 'stop' : script.icon ?? 'play'}
                          />
                          <span>{scriptDisplayName(script.name)}</span>
                          {active ? (
                            <span className="dev-script-port">
                              :
                              {
                                thread.activeRuns?.find(
                                  (r) => r.scriptName === script.name,
                                )?.port
                              }
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
                <li className="dev-script-sep" aria-hidden />
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setRunMenuOpen(false);
                      void openRunConfig();
                    }}
                  >
                    <RunScriptIcon name="settings" />
                    <span>Configure</span>
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
        </div>

        <div className="right-lower-body">
          {lower === 'setup' && (
            <div className={`setup-panel${setupOutput || setupRunning ? ' has-log' : ''}`}>
              {!setupInfo ? (
                <div className="panel-empty">
                  <div className="panel-empty-title">Loading setup…</div>
                </div>
              ) : setupOutput || setupRunning ? (
                <>
                  <pre ref={setupOutputRef} className="setup-output has-output">
                    {setupOutput || 'Running setup…'}
                  </pre>
                  {setupInfo.hasSetupScript ? (
                    <div className="panel-footer-actions">
                      <button
                        type="button"
                        className="ghost-action"
                        disabled={setupRunning}
                        onClick={() => void runSetupScript()}
                      >
                        {setupRunning ? 'Running…' : '▶ Run setup again'}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="panel-empty">
                  <div className="panel-empty-title">No setup script output</div>
                  <p className="panel-empty-copy">
                    {setupInfo.hasSetupScript
                      ? 'Setup script output will appear here after running setup.'
                      : setupInfo.hasConfig
                        ? 'No setup script defined in settings.toml.'
                        : 'No .sideboard or .conductor settings.toml in this worktree.'}
                  </p>
                  {setupInfo.hasSetupScript ? (
                    <button
                      type="button"
                      className="ghost-action"
                      disabled={setupRunning}
                      onClick={() => void runSetupScript()}
                    >
                      ▶ Run setup
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost-action"
                      disabled={agentSetupBusy}
                      onClick={() => void useAgentSetup()}
                    >
                      {agentSetupBusy ? 'Starting agent…' : '▶ Use agent to set up'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {lower === 'run' && (
            <div
              className={`run-panel${
                thread.devPort || Object.keys(runLogs).some((k) => runLogs[k])
                  ? ' has-log'
                  : ''
              }`}
            >
              {thread.devPort || Object.keys(runLogs).some((k) => runLogs[k]) ? (
                <>
                  <div className="run-log-header">
                    Running{' '}
                    {scriptDisplayName(
                      primaryScriptName ??
                        thread.activeRuns?.[0]?.scriptName ??
                        defaultRunScript?.name ??
                        'Dev',
                    )}
                  </div>
                  <pre className="setup-output has-output run-log">
                    {Object.entries(runLogs)
                      .filter(([, log]) => log)
                      .map(([name, log]) =>
                        (thread.activeRuns?.length ?? 0) > 1 ? `[${name}]\n${log}` : log,
                      )
                      .join('\n\n') || 'Starting…'}
                  </pre>
                </>
              ) : (
                <div className="panel-empty">
                  <div className="run-hero" aria-hidden>
                    ▶
                  </div>
                  <button
                    type="button"
                    className="ghost-action run-start"
                    disabled={!hasHook && runScripts.length === 0}
                    onClick={() => void toggleDev()}
                  >
                    Start {defaultRunScript ? scriptDisplayName(defaultRunScript.name) : 'Dev'}{' '}
                    <kbd>⌘R</kbd>
                  </button>
                  <p className="panel-empty-copy">Test your changes here.</p>
                </div>
              )}
            </div>
          )}

          {lower === 'terminal' && (
            <div className="terminal-panel">
              <EmbeddedTerminal key={thread.id} threadId={thread.id} mode="shell" />
            </div>
          )}
        </div>
      </div>

      {landPreview && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!landBusy) {
              setLandPreview(null);
              setLandError(null);
            }
          }}
        >
          <div
            className="modal confirm-modal land-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="land-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="land-confirm-title">{landTitle()}</h3>
            <p className="confirm-dialog-message">
              {landOpts.web
                ? 'Push this branch, then open GitHub to finish the pull request.'
                : thread.prUrl
                  ? 'Push this branch and update the existing pull request.'
                  : 'Push this branch and open a pull request on GitHub.'}
            </p>
            <dl className="land-confirm-meta">
              <div>
                <dt>Branch</dt>
                <dd>
                  <span className="land-confirm-branch">{landPreview.branch}</span>
                  <span className="land-confirm-arrow">→</span>
                  <span>{landPreview.target}</span>
                </dd>
              </div>
              <div>
                <dt>Working tree</dt>
                <dd>
                  {landPreview.dirty ? 'Dirty — will auto-commit before push' : 'Clean'}
                </dd>
              </div>
            </dl>
            {landPreview.diffStat.trim() ? (
              <pre className="land-confirm-stat">{landPreview.diffStat}</pre>
            ) : (
              <p className="land-confirm-empty">No diff against {landPreview.target}</p>
            )}
            {landPreview.blocked && (
              <p className="land-confirm-error">{landPreview.blockReason}</p>
            )}
            {landError && <p className="land-confirm-error">{landError}</p>}
            <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
              <button
                type="button"
                disabled={landBusy}
                onClick={() => {
                  setLandPreview(null);
                  setLandError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={landPreview.blocked || landBusy}
                onClick={() => void confirmLandPush()}
              >
                {landConfirmLabel()}
              </button>
            </div>
          </div>
        </div>
      )}

      {mergeConfirm && (
        <MergeModal
          prNumber={num}
          prTitle={prMeta?.title ?? thread.prTitle}
          branch={thread.branchName}
          target={prMeta?.baseRefName || 'main'}
          isDraft={Boolean(prMeta?.isDraft)}
          busy={mergeBusy}
          error={mergeError}
          onConfirm={() => void confirmMergePr()}
          onCancel={() => {
            if (!mergeBusy) {
              setMergeConfirm(false);
              setMergeError(null);
            }
          }}
        />
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
