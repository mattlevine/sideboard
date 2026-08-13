import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  DiffScope,
  MessagePart,
  OrchestratorEvent,
  OrchestratorRuntime,
  Thread,
  Workspace,
} from '@sideboard-ai/core';
import { lookupSoccerTeam } from '@sideboard/teams';
import { applyAgentEvent } from '@sideboard/message-parts';
import { Sidebar } from './components/Sidebar';
import { ThreadPanel } from './components/ThreadPanel';
import { CreateModal } from './components/CreateModal';
import { CreateProcessingOverlay } from './components/CreateProcessingOverlay';
import { OrchestratorPanel } from './components/OrchestratorPanel';
import { GlobalBoard } from './components/GlobalBoard';
import { RightSidebar } from './components/RightSidebar';
import { SidebarToggle } from './components/SidebarToggle';
import { SettingsModal } from './components/SettingsModal';
import { PanelResizeHandle } from './components/PanelResizeHandle';
import { TeamToastStack, type TeamToastItem } from './components/TeamToast';
import { GLOBAL_WORKSPACE_ID, isGlobalThread } from './lib/global-workspace';
import { normalizePreviewUrl } from './lib/preview-url';
import {
  readRightSidebarOpen,
  readRightSidebarWidth,
  writeRightSidebarOpen,
  writeRightSidebarWidth,
} from './lib/right-sidebar-prefs';
import {
  baselineUnreadWorktrees,
  latestAgentResponseAt,
  markWorktreeSeen,
  unreadWorktreeKey,
} from './lib/unread-worktrees';

const LEFT_SIDEBAR_DEFAULT = 280;
const RIGHT_SIDEBAR_DEFAULT = 340;
const LEFT_SIDEBAR_MIN = 180;
const LEFT_SIDEBAR_MAX = 480;
const RIGHT_SIDEBAR_MIN = 240;
const RIGHT_SIDEBAR_MAX = 560;
/** Stable empty parts — `?? []` in render would retrigger chat auto-scroll on every live chunk. */
const EMPTY_LIVE_PARTS: MessagePart[] = [];

function sameWorktreePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\/$/, '');
  return norm(a) === norm(b);
}

function readSidebarPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function readSidebarWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  } catch {
    return fallback;
  }
}

function writeSidebarWidth(key: string, width: number) {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    // ignore
  }
}

interface CreateState {
  repoPath: string | null;
  mode: 'quick' | 'orchestration';
}

/** Non-blocking status in the chat empty pane (create + archive teardown). */
interface PaneProgress {
  mode: 'create' | 'orchestration' | 'archive' | 'remove';
  repoName: string;
  selectionHint: string | null;
}

export function App() {
  const [repoPath, setRepoPath] = useState('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [archived, setArchived] = useState<Thread[]>([]);
  const [view, setView] = useState<'board' | 'thread'>('board');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  /** Thread currently tearing down via archive (sidebar shows progress). */
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [createState, setCreateState] = useState<CreateState | null>(null);
  /** Non-blocking create/archive status shown in the chat empty state. */
  const [paneProgress, setPaneProgress] = useState<PaneProgress | null>(null);
  const [liveByThread, setLiveByThread] = useState<Record<string, string>>({});
  const [livePartsByThread, setLivePartsByThread] = useState<Record<string, MessagePart[]>>({});
  const [turnStartedAtByThread, setTurnStartedAtByThread] = useState<Record<string, number>>({});
  const [runtime, setRuntime] = useState<OrchestratorRuntime | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [appUpdate, setAppUpdate] = useState<{
    phase: 'available' | 'ready';
    version: string;
  } | null>(null);
  const [teamToasts, setTeamToasts] = useState<TeamToastItem[]>([]);
  const [prefill, setPrefill] = useState<string | undefined>();
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [openFileView, setOpenFileView] = useState<'edit' | 'diff'>('edit');
  const [openUrls, setOpenUrls] = useState<string[]>([]);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  /** Dedicated Changes center tab (not a per-file name tab). */
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesPath, setChangesPath] = useState<string | null>(null);
  const [changesDiffScope, setChangesDiffScope] = useState<DiffScope>('uncommitted');
  const [changesCommitSha, setChangesCommitSha] = useState<string | null>(null);
  const [changesDiffBase, setChangesDiffBase] = useState<string | null>(null);
  const [fileChanges, setFileChanges] = useState<
    Record<string, { status: string; additions?: number; deletions?: number }>
  >({});
  const onFileChanges = useCallback(
    (changes: Record<string, { status: string; additions?: number; deletions?: number }>) => {
      setFileChanges(changes);
    },
    [],
  );

  useEffect(() => {
    setFileChanges({});
    setChangesOpen(false);
    setChangesPath(null);
  }, [selectedId]);

  function openFile(
    path: string,
    opts?: {
      view?: 'edit' | 'diff';
      scope?: DiffScope;
      commitSha?: string | null;
      base?: string | null;
    },
  ) {
    if (opts?.view === 'diff') {
      setChangesOpen(true);
      setChangesPath(path);
      setChangesDiffScope(opts.scope ?? 'uncommitted');
      setChangesCommitSha(opts.commitSha ?? null);
      setChangesDiffBase(opts.base ?? null);
      setOpenFilePath(null);
      setOpenUrl(null);
      setOpenFileView('diff');
      return;
    }
    setChangesOpen(false);
    setOpenUrl(null);
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setOpenFilePath(path);
    setOpenFileView('edit');
  }

  function closeFile(path: string) {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path);
      setOpenFilePath((active) => {
        if (active !== path) return active;
        return next[next.length - 1] ?? null;
      });
      return next;
    });
  }

  function openPreviewUrl(raw: string) {
    const url = normalizePreviewUrl(raw);
    if (!url) {
      // Chat markdown may still hand us a safe http(s)/mailto URL that the
      // in-app preview can't load — fall back to the system browser.
      if (/^https?:\/\//i.test(raw.trim()) || /^mailto:/i.test(raw.trim())) {
        void window.sideboard.openExternal(raw.trim());
      }
      return;
    }
    setChangesOpen(false);
    setOpenFilePath(null);
    setOpenUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
    setOpenUrl(url);
  }

  function selectPreviewUrl(url: string) {
    setChangesOpen(false);
    setOpenFilePath(null);
    setOpenUrl(url);
  }

  function closePreviewUrl(url: string) {
    setOpenUrls((prev) => {
      const next = prev.filter((u) => u !== url);
      setOpenUrl((active) => {
        if (active !== url) return active;
        return next[next.length - 1] ?? null;
      });
      return next;
    });
  }

  function navigatePreviewUrl(from: string, toRaw: string) {
    const to = normalizePreviewUrl(toRaw);
    if (!to) return;
    setOpenUrls((prev) => {
      const without = prev.filter((u) => u !== from);
      return without.includes(to) ? without : [...without, to];
    });
    setOpenUrl(to);
  }

  function closeChanges() {
    setChangesOpen(false);
    setChangesPath(null);
    setChangesDiffScope('uncommitted');
    setChangesCommitSha(null);
    setChangesDiffBase(null);
  }

  function selectChangesTab() {
    setChangesOpen(true);
    setOpenFilePath(null);
    setOpenUrl(null);
  }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialNav, setSettingsInitialNav] = useState<
    'account' | 'agents' | 'environment' | 'advanced' | 'history'
  >('account');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() =>
    readSidebarPref('sideboard.leftSidebar', true),
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() =>
    readRightSidebarOpen(null, true),
  );
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() =>
    readSidebarWidth(
      'sideboard.leftSidebarWidth',
      LEFT_SIDEBAR_DEFAULT,
      LEFT_SIDEBAR_MIN,
      LEFT_SIDEBAR_MAX,
    ),
  );
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    readRightSidebarWidth(null, RIGHT_SIDEBAR_DEFAULT),
  );

  const persistLeftSidebarWidth = useCallback((width: number) => {
    writeSidebarWidth('sideboard.leftSidebarWidth', width);
  }, []);

  function toggleLeftSidebar() {
    setLeftSidebarOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem('sideboard.leftSidebar', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  const refresh = useCallback(async () => {
    const [all, rt, ws] = await Promise.all([
      window.sideboard.getThreads(true),
      window.sideboard.getRuntime(),
      window.sideboard.listWorkspaces().catch(() => [] as Workspace[]),
    ]);
    setThreads(all.filter((t) => t.status !== 'archived'));
    setArchived(all.filter((t) => t.status === 'archived'));
    setRuntime(rt);
    setWorkspaces(Array.isArray(ws) ? ws : []);
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const ws = await window.sideboard.listWorkspaces();
      setWorkspaces(Array.isArray(ws) ? ws : []);
    } catch {
      setWorkspaces([]);
    }
  }, []);

  const notifySoccerNickname = useCallback((title: string | null | undefined) => {
    if (!title?.trim()) return;
    const team = lookupSoccerTeam(title);
    if (!team) return;
    setTeamToasts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), team },
    ]);
  }, []);

  const dismissTeamToast = useCallback((id: string) => {
    setTeamToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const upsertThread = useCallback((thread: Thread) => {
    setThreads((prev) => [...prev.filter((t) => t.id !== thread.id), thread]);
  }, []);

  const selectCreatedThread = useCallback(
    (thread: Thread) => {
      // Same focus path as CreateModal → ticket/branch create.
      upsertThread(thread);
      notifySoccerNickname(thread.title);
      void refresh();
      setSelectedId(thread.id);
      setView('thread');
      setMultiSelected(new Set([thread.id]));
      setLeftSidebarOpen(true);
    },
    [upsertThread, notifySoccerNickname, refresh],
  );

  useEffect(() => {
    void window.sideboard.getRepoPath().then(async (p) => {
      const path = typeof p === 'string' ? p.trim() : '';
      // Packaged apps often report cwd `/` — never treat that as a project.
      if (!path || path === '/') {
        setRepoPath('');
        if (path === '/') {
          void window.sideboard.setRepoPath('').catch(() => undefined);
        }
        return;
      }
      setRepoPath(path);
      try {
        await window.sideboard.addWorkspace(path);
      } catch {
        // ignore
      }
    });
    void refresh();
    const offThreads = window.sideboard.onThreadsChanged(() => {
      void refresh();
    });
    const offEvents = window.sideboard.onEvent((event: OrchestratorEvent) => {
      if (event.type === 'turn_output') {
        const ev = event.event;
        if (
          ev.type === 'stdout' &&
          !(
            /^\s*\{/.test(ev.data) &&
            /"type"\s*:\s*"(tool_use|tool_result|tool|thinking|usage|done|error)"/.test(
              ev.data,
            )
          )
        ) {
          setLiveByThread((prev) => ({
            ...prev,
            [event.threadId]: `${prev[event.threadId] ?? ''}${ev.data}`,
          }));
        }
        if (
          ev.type === 'stdout' ||
          ev.type === 'thinking' ||
          ev.type === 'tool_use' ||
          ev.type === 'tool_result'
        ) {
          setLivePartsByThread((prev) => ({
            ...prev,
            [event.threadId]: applyAgentEvent(prev[event.threadId] ?? [], ev),
          }));
        }
      }
      if (event.type === 'turn_started') {
        setLiveByThread((prev) => ({ ...prev, [event.threadId]: '' }));
        setLivePartsByThread((prev) => ({ ...prev, [event.threadId]: [] }));
        setTurnStartedAtByThread((prev) => ({ ...prev, [event.threadId]: Date.now() }));
      }
      if (event.type === 'turn_finished') {
        // Keep the streamed bubble until refresh lands the persisted agent message
        void refresh().then(() => {
          setLiveByThread((prev) => ({ ...prev, [event.threadId]: '' }));
          setLivePartsByThread((prev) => ({ ...prev, [event.threadId]: [] }));
          setTurnStartedAtByThread((prev) => {
            const next = { ...prev };
            delete next[event.threadId];
            return next;
          });
        });
        return;
      }
      if (event.type === 'context_compacted') {
        void refresh();
        return;
      }
      if (event.type === 'quota_failover') {
        void refresh().then(() => {
          if (event.toThreadId) setSelectedId(event.toThreadId);
        });
        return;
      }
      if (
        event.type === 'status_changed' ||
        event.type === 'queue_changed' ||
        event.type === 'dev_server_started' ||
        event.type === 'dev_server_stopped' ||
        event.type === 'error'
      ) {
        void refresh();
      }
    });
    const dismissedKey = 'sideboard.dismissedUpdateVersion';
    const isDismissed = (version: string) => {
      try {
        return localStorage.getItem(dismissedKey) === version;
      } catch {
        return false;
      }
    };
    const offAvailable = window.sideboardUpdate.onAvailable((info) => {
      if (isDismissed(info.version)) return;
      setAppUpdate((prev) =>
        prev?.phase === 'ready' && prev.version === info.version
          ? prev
          : { phase: 'available', version: info.version },
      );
    });
    const offReady = window.sideboardUpdate.onReady((info) => {
      // Always surface "ready" even if the earlier available toast was dismissed.
      setAppUpdate({ phase: 'ready', version: info.version });
    });
    const offUpdateError = window.sideboardUpdate.onError(() => {
      setAppUpdate((prev) => (prev?.phase === 'available' ? null : prev));
    });
    const offOpenSettings = window.sideboardUpdate.onOpenSettings(() => {
      setSettingsInitialNav('account');
      setSettingsOpen(true);
    });
    return () => {
      offThreads();
      offEvents();
      offAvailable();
      offReady();
      offUpdateError();
      offOpenSettings();
    };
  }, [refresh]);

  // Conductor-style: lightly follow open PRs so external merges purple + auto-archive.
  const openPrSyncKey = useMemo(() => {
    return threads
      .filter(
        (t) =>
          !isGlobalThread(t) &&
          Boolean(t.prUrl?.trim()) &&
          (t.prState ?? '').toUpperCase() !== 'MERGED' &&
          (t.prState ?? '').toUpperCase() !== 'CLOSED',
      )
      .map((t) => `${t.id}:${(t.worktreePath || '').replace(/\/$/, '')}`)
      .sort()
      .join('|');
  }, [threads]);

  useEffect(() => {
    if (!openPrSyncKey) return;
    let cancelled = false;
    let running = false;

    async function syncOpenPrStates() {
      if (cancelled || running) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // Dedupe by worktree; prefer first thread id per worktree.
      const seenWt = new Set<string>();
      const ids: string[] = [];
      for (const entry of openPrSyncKey.split('|')) {
        const [id, wt = ''] = entry.split(':');
        if (!id || seenWt.has(wt)) continue;
        seenWt.add(wt);
        ids.push(id);
      }
      if (ids.length === 0) return;
      running = true;
      try {
        for (const id of ids) {
          if (cancelled) break;
          try {
            await window.sideboard.getPrMeta(id);
          } catch {
            // ignore per-thread failures (offline / no PR)
          }
        }
      } finally {
        running = false;
      }
    }

    void syncOpenPrStates();
    const onVis = () => {
      if (document.visibilityState === 'visible') void syncOpenPrStates();
    };
    document.addEventListener('visibilitychange', onVis);
    const interval = window.setInterval(() => void syncOpenPrStates(), 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(interval);
    };
  }, [openPrSyncKey]);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? archived.find((t) => t.id === selectedId) ?? null,
    [threads, archived, selectedId],
  );

  const rightSidebarWorktreeKey = useMemo(() => {
    if (!selected || isGlobalThread(selected)) return null;
    return selected.worktreePath?.trim() || null;
  }, [selected]);

  // Restore per-worktree open/closed + width when switching worktrees.
  useEffect(() => {
    if (!rightSidebarWorktreeKey) return;
    setRightSidebarOpen(readRightSidebarOpen(rightSidebarWorktreeKey, true));
    setRightSidebarWidth(
      readRightSidebarWidth(rightSidebarWorktreeKey, RIGHT_SIDEBAR_DEFAULT),
    );
  }, [rightSidebarWorktreeKey]);

  const toggleRightSidebar = useCallback(() => {
    setRightSidebarOpen((v) => {
      const next = !v;
      writeRightSidebarOpen(rightSidebarWorktreeKey, next);
      return next;
    });
  }, [rightSidebarWorktreeKey]);

  const persistRightSidebarWidth = useCallback(
    (width: number) => {
      writeRightSidebarWidth(rightSidebarWorktreeKey, width);
    },
    [rightSidebarWorktreeKey],
  );

  // File tabs are scoped to the active worktree; URL tabs stay open across worktrees.
  useEffect(() => {
    setOpenFiles([]);
    setOpenFilePath(null);
  }, [selected?.worktreePath]);

  const children = useMemo(
    () => (selected ? threads.filter((t) => t.parentThreadId === selected.id) : []),
    [threads, selected],
  );

  const worktreeChats = useMemo(() => {
    if (!selected) return [];
    return threads
      .filter((t) => sameWorktreePath(t.worktreePath, selected.worktreePath))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [threads, selected]);

  const knownWorkspaces = useMemo(() => {
    const byPath = new Map<string, Workspace>();
    for (const ws of workspaces) {
      if (!ws.path || ws.path === GLOBAL_WORKSPACE_ID || byPath.has(ws.path)) continue;
      byPath.set(ws.path, ws);
    }
    for (const t of threads) {
      if (!t.repoPath || t.repoPath === GLOBAL_WORKSPACE_ID || byPath.has(t.repoPath)) continue;
      const name = t.repoPath.split('/').filter(Boolean).pop() || t.repoPath;
      byPath.set(t.repoPath, {
        path: t.repoPath,
        name,
        addedAt: t.createdAt,
      });
    }
    if (repoPath && repoPath !== GLOBAL_WORKSPACE_ID && !byPath.has(repoPath)) {
      const name = repoPath.split('/').filter(Boolean).pop() || repoPath;
      byPath.set(repoPath, {
        path: repoPath,
        name,
        addedAt: new Date().toISOString(),
      });
    }
    return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [workspaces, threads, repoPath]);

  useEffect(() => {
    setOpenFilePath(null);
  }, [selectedId]);

  // Seed last-seen so historical rows don't all flash unread on first launch.
  useEffect(() => {
    baselineUnreadWorktrees(threads);
  }, [threads]);

  // While a worktree/orchestration is open, keep it marked seen so finishes
  // while watching don't light up the sidebar when you navigate away.
  useEffect(() => {
    if (view !== 'thread' || !selectedId) return;
    const selectedThread =
      threads.find((t) => t.id === selectedId) ??
      archived.find((t) => t.id === selectedId);
    if (!selectedThread) return;
    const key = unreadWorktreeKey(selectedThread);
    if (!key) return;
    const group = threads.filter((t) => unreadWorktreeKey(t) === key);
    const activity = latestAgentResponseAt(group) ?? new Date().toISOString();
    markWorktreeSeen(key, activity);
  }, [view, selectedId, threads, archived]);

  function onSelect(id: string, multi: boolean) {
    setView('thread');
    setSelectedId(id);
    const selectedThread = threads.find((t) => t.id === id);
    if (selectedThread && !multi) {
      const key = unreadWorktreeKey(selectedThread);
      const group = threads.filter((t) => unreadWorktreeKey(t) === key);
      markWorktreeSeen(key, latestAgentResponseAt(group) ?? new Date().toISOString());
    }
    if (!multi) {
      setMultiSelected(new Set([id]));
      return;
    }
    setMultiSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Archive one or more chats. When a worktree is torn down, leave the chat
   * immediately and show progress in the empty pane (same as create) — do not
   * block on a modal overlay while git worktree remove runs.
   */
  async function archiveThreadsAndRefresh(
    ids: string[],
    meta?: { title?: string; removesWorktree?: boolean },
  ) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return;

    const first =
      threads.find((t) => t.id === uniqueIds[0]) ??
      archived.find((t) => t.id === uniqueIds[0]) ??
      null;
    const label =
      meta?.title?.trim() ||
      first?.title?.trim() ||
      first?.branchName?.replace(/^thread\//, '') ||
      'Worktree';
    const removesWorktree = meta?.removesWorktree !== false;
    const idSet = new Set(uniqueIds);
    const leavesSelection =
      (selectedId != null && idSet.has(selectedId)) ||
      [...multiSelected].some((id) => idSet.has(id));

    // Tear-down: leave immediately + inline progress (non-blocking, like create).
    if (removesWorktree) {
      setPaneProgress({
        mode: 'archive',
        repoName: label,
        selectionHint:
          uniqueIds.length > 1 ? `${uniqueIds.length} chats` : 'removing worktree',
      });
      setSelectedId(null);
      setMultiSelected(new Set());
      setView('thread');
    } else if (leavesSelection) {
      // Closing one tab among siblings — switch away without a progress pane.
      const sibling = threads.find(
        (t) =>
          !idSet.has(t.id) &&
          first != null &&
          t.worktreePath.replace(/\/$/, '') ===
            first.worktreePath.replace(/\/$/, ''),
      );
      if (sibling) {
        setSelectedId(sibling.id);
        setMultiSelected(new Set([sibling.id]));
      } else {
        setSelectedId(null);
        setMultiSelected(new Set());
        setView('board');
      }
    }

    try {
      for (const id of uniqueIds) {
        setArchivingId(id);
        await window.sideboard.archiveThread(id);
      }
      await refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setArchivingId(null);
      if (removesWorktree) {
        setPaneProgress((prev) => (prev?.mode === 'archive' ? null : prev));
        setView('board');
        setSelectedId(null);
      }
    }
  }

  async function archiveThreadAndRefresh(id: string) {
    return archiveThreadsAndRefresh([id], { removesWorktree: true });
  }

  async function removeWorkspaceAndRefresh(path: string) {
    const inWorkspace = threads.filter((t) => t.repoPath === path);
    const name = path.split('/').filter(Boolean).pop() || path;
    setPaneProgress({
      mode: 'remove',
      repoName: name,
      selectionHint:
        inWorkspace.length > 0
          ? `${inWorkspace.length} thread${inWorkspace.length === 1 ? '' : 's'}`
          : 'sidebar',
    });
    setSelectedId(null);
    setMultiSelected(new Set());
    setView('thread');

    try {
      for (const t of inWorkspace) {
        setArchivingId(t.id);
        await window.sideboard.archiveThread(t.id);
      }
      setArchivingId(null);
      await window.sideboard.removeWorkspace(path);
      if (repoPath === path || path === '/') {
        setRepoPath('');
        try {
          await window.sideboard.setRepoPath('');
        } catch {
          // ignore
        }
      }
      await refreshWorkspaces();
      await refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setArchivingId(null);
      setPaneProgress((prev) => (prev?.mode === 'remove' ? null : prev));
      setView('board');
      setSelectedId(null);
    }
  }

  function showBoard() {
    setView('board');
    setSelectedId(null);
  }

  function openThreadByRef(threadRef: string) {
    const ref = threadRef.trim();
    if (!ref) return;
    const match =
      threads.find(
        (t) => t.id === ref || t.id.startsWith(ref) || t.branchName === ref || t.title === ref,
      ) ?? null;
    if (!match) {
      window.alert(`Thread not found: ${ref}`);
      return;
    }
    setSelectedId(match.id);
    setView('thread');
    setMultiSelected(new Set([match.id]));
  }

  function openCreate(forRepo?: string, mode: CreateState['mode'] = 'quick') {
    const repo =
      forRepo && forRepo !== GLOBAL_WORKSPACE_ID ? forRepo : null;
    setCreateState({ repoPath: repo, mode });
  }

  /** Orchestration chats have no worktree — Changes/Files/Terminal sidebar is N/A. */
  const showRightSidebar = Boolean(selected && !isGlobalThread(selected));
  const rightSidebarVisible = showRightSidebar && rightSidebarOpen;

  const appClass = [
    'app',
    view === 'thread' && selected && showRightSidebar ? 'with-right' : '',
    leftSidebarOpen ? '' : 'left-collapsed',
  ]
    .filter(Boolean)
    .join(' ');

  const appStyle = {
    '--left-sidebar-width': `${leftSidebarWidth}px`,
    '--right-sidebar-width': `${rightSidebarWidth}px`,
  } as CSSProperties;

  return (
    <div className={appClass} style={appStyle}>
      {leftSidebarOpen && (
        <div className="sidebar-slot">
          <Sidebar
            threads={threads}
            selectedId={selectedId}
            view={view}
            multiSelected={multiSelected}
            repoPath={repoPath}
            workspaces={workspaces}
            onShowBoard={showBoard}
            onSelect={onSelect}
            onNew={(path, mode) => openCreate(path, mode ?? 'quick')}
            onPickRepo={() =>
              void window.sideboard.pickRepoPath().then(async (p) => {
                if (!p) return;
                setRepoPath(p);
                await window.sideboard.addWorkspace(p);
                await refreshWorkspaces();
                await refresh();
              })
            }
            onArchive={(ids, meta) => archiveThreadsAndRefresh(ids, meta)}
            archivingId={archivingId}
            onRemoveWorkspace={removeWorkspaceAndRefresh}
            onToggleSidebar={toggleLeftSidebar}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <PanelResizeHandle
            edge="right"
            value={leftSidebarWidth}
            min={LEFT_SIDEBAR_MIN}
            max={LEFT_SIDEBAR_MAX}
            onChange={setLeftSidebarWidth}
            onChangeEnd={persistLeftSidebarWidth}
          />
        </div>
      )}

      {view === 'board' && (
        <GlobalBoard
          threads={threads}
          runtime={runtime}
          liveByThread={liveByThread}
          onOpenThread={(id) => {
            setSelectedId(id);
            setView('thread');
            setMultiSelected(new Set([id]));
          }}
          onNewGlobalChat={() => openCreate(undefined, 'orchestration')}
          onRefresh={() => void refresh()}
          leftSidebarToggle={
            !leftSidebarOpen ? (
              <SidebarToggle side="left" open={false} onClick={toggleLeftSidebar} />
            ) : undefined
          }
        />
      )}

      {view === 'thread' && selected && (
        <div
          className={`thread-workspace${
            showRightSidebar && rightSidebarVisible ? ' has-right' : ''
          }`}
        >
          {(() => {
            const leftToggle = !leftSidebarOpen ? (
              <SidebarToggle side="left" open={false} onClick={toggleLeftSidebar} />
            ) : undefined;
            const rightToggle = showRightSidebar ? (
              <SidebarToggle
                side="right"
                open={rightSidebarVisible}
                onClick={toggleRightSidebar}
              />
            ) : undefined;
            const threadPanelProps = {
              worktreeChats,
              liveOutput: liveByThread[selected.id] ?? '',
              liveParts: livePartsByThread[selected.id] ?? EMPTY_LIVE_PARTS,
              turnStartedAt: turnStartedAtByThread[selected.id],
              onRefresh: () => void refresh(),
              onSelectChat: (id: string, created?: Thread) => {
                if (created) {
                  selectCreatedThread(created);
                  return;
                }
                setSelectedId(id);
                setMultiSelected(new Set([id]));
              },
              onLeaveThread: showBoard,
              onArchiveThread: (id: string, meta?: { title?: string; removesWorktree?: boolean }) =>
                archiveThreadsAndRefresh([id], meta),
              composerPrefill: prefill,
              onComposerPrefillConsumed: () => setPrefill(undefined),
              leftSidebarToggle: leftToggle,
              rightSidebarToggle: rightToggle,
              onOpenThreadLink: openThreadByRef,
            };
            const urlPreviewProps = {
              openUrls,
              openUrl,
              onSelectUrl: selectPreviewUrl,
              onCloseUrl: closePreviewUrl,
              onNavigateUrl: navigatePreviewUrl,
              onShowChat: () => {
                setOpenFilePath(null);
                setOpenUrl(null);
                setChangesOpen(false);
              },
              urlPreviewSuspended: settingsOpen,
            };
            return selected.sourceType === 'orchestration' || isGlobalThread(selected) ? (
            <OrchestratorPanel
              key={selected.id}
              thread={selected}
              childThreads={children}
              worktreeChats={worktreeChats}
              liveOutput={liveByThread[selected.id] ?? ''}
              liveParts={livePartsByThread[selected.id] ?? EMPTY_LIVE_PARTS}
              turnStartedAt={turnStartedAtByThread[selected.id]}
              onRefresh={() => void refresh()}
              onSelectChild={(id) => {
                setSelectedId(id);
                setView('thread');
                setMultiSelected(new Set([id]));
              }}
              onSelectChat={(id, created) => {
                if (created) {
                  selectCreatedThread(created);
                  return;
                }
                setSelectedId(id);
                setMultiSelected(new Set([id]));
              }}
              onLeaveThread={showBoard}
              composerPrefill={prefill}
              onComposerPrefillConsumed={() => setPrefill(undefined)}
              leftSidebarToggle={leftToggle}
              rightSidebarToggle={rightToggle}
              onOpenThreadLink={openThreadByRef}
              {...urlPreviewProps}
            />
          ) : (
            <ThreadPanel
              key={selected.id}
              thread={selected}
              openFilePath={openFilePath}
              openFiles={openFiles}
              openFileView={openFileView}
              changesOpen={changesOpen}
              changesPath={changesPath}
              changesDiffScope={changesDiffScope}
              changesCommitSha={changesCommitSha}
              changesDiffBase={changesDiffBase}
              onSelectFile={openFile}
              onCloseFile={closeFile}
              onSelectChanges={selectChangesTab}
              onCloseChanges={closeChanges}
              fileChanges={fileChanges}
              {...urlPreviewProps}
              {...threadPanelProps}
            />
          );
          })()}
          {showRightSidebar && rightSidebarVisible && (
            <div className="right-sidebar-slot">
              <PanelResizeHandle
                edge="left"
                value={rightSidebarWidth}
                min={RIGHT_SIDEBAR_MIN}
                max={RIGHT_SIDEBAR_MAX}
                onChange={setRightSidebarWidth}
                onChangeEnd={persistRightSidebarWidth}
              />
              <RightSidebar
                key={selected.worktreePath.replace(/\/$/, '') || selected.id}
                thread={selected}
                onRefresh={() => void refresh()}
                onArchiveThread={(id, meta) =>
                  archiveThreadsAndRefresh([id], meta)
                }
                archiving={archivingId === selected.id}
                openFilePath={openFilePath}
                changesPath={changesPath}
                onOpenFile={openFile}
                onOpenUrl={openPreviewUrl}
                onFileChanges={onFileChanges}
                onSelectChat={(id, created) => {
                  if (created) {
                    selectCreatedThread(created);
                    return;
                  }
                  setSelectedId(id);
                  setMultiSelected(new Set([id]));
                }}
                onAskAboutFile={(path) =>
                  setPrefill(`Look at the changes in ${path} and suggest next steps.`)
                }
              />
            </div>
          )}
        </div>
      )}
      {view === 'thread' && paneProgress && !selected && (
        <div className="panel thread-panel">
          <div className="chat">
            <div className="chat-empty">
              <CreateProcessingOverlay
                variant="inline"
                mode={paneProgress.mode}
                repoName={paneProgress.repoName}
                selectionHint={paneProgress.selectionHint}
              />
              <h3>
                {paneProgress.mode === 'orchestration'
                  ? 'What should we orchestrate?'
                  : paneProgress.mode === 'archive'
                    ? 'Removing worktree'
                    : paneProgress.mode === 'remove'
                      ? 'Removing project'
                      : 'What are you working on?'}
              </h3>
              <p>
                {paneProgress.mode === 'orchestration'
                  ? 'Preparing the coordinator chat…'
                  : paneProgress.mode === 'archive'
                    ? 'Tearing down the worktree — you can keep browsing while this finishes.'
                    : paneProgress.mode === 'remove'
                      ? 'Archiving threads and removing the project from the sidebar…'
                      : 'Creating your worktree — you can keep browsing while this finishes.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {view === 'thread' && !selected && !paneProgress && (
        <div className="empty">
          Thread not found.{' '}
          <button onClick={showBoard}>Back to board</button>
        </div>
      )}

      {createState && (
        <CreateModal
          initialRepoPath={createState.repoPath}
          knownWorkspaces={knownWorkspaces}
          initialMode={createState.mode}
          onClose={() => setCreateState(null)}
          onWorkspacesChanged={() => {
            void refreshWorkspaces();
          }}
          onOpenAccount={() => {
            setCreateState(null);
            setSettingsOpen(true);
            setSettingsInitialNav('account');
          }}
          onCreateStart={(info) => {
            setPaneProgress(info);
            setSelectedId(null);
            setView('thread');
            setMultiSelected(new Set());
          }}
          onCreateFailed={(message) => {
            setPaneProgress(null);
            setView('board');
            window.alert(message);
          }}
          onCreated={(thread, opts) => {
            setPaneProgress(null);
            upsertThread(thread);
            notifySoccerNickname(thread.title);
            void refresh();
            if (opts?.stayOpen) return;
            setSelectedId(thread.id);
            setView('thread');
            setMultiSelected(new Set([thread.id]));
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          initialNav={settingsInitialNav}
          archived={archived}
          onRestoreArchived={(id) => {
            void window.sideboard.restoreThread(id).then(() => {
              void refresh();
            });
          }}
          onOpenArchived={(id) => {
            setSettingsOpen(false);
            setSettingsInitialNav('account');
            setSelectedId(id);
            setView('thread');
            setMultiSelected(new Set([id]));
          }}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsInitialNav('account');
          }}
        />
      )}

      {appUpdate && (
        <div className="update-banner" role="status">
          <div className="update-banner-text">
            <strong>
              {appUpdate.phase === 'ready' ? 'Update ready' : 'Update available'}
            </strong>
            <span>
              {appUpdate.phase === 'ready'
                ? `Sideboard ${appUpdate.version} is ready to install.`
                : `Sideboard ${appUpdate.version} is downloading in the background.`}
            </span>
          </div>
          <div className="update-banner-actions">
            {appUpdate.phase === 'ready' && (
              <button
                type="button"
                className="primary"
                onClick={() => void window.sideboardUpdate.install()}
              >
                Restart to update
              </button>
            )}
            <button
              type="button"
              className="update-banner-dismiss"
              title="Dismiss"
              aria-label="Dismiss update notification"
              onClick={() => {
                // Only snooze the "available" phase; ready should reappear next launch
                // until the user installs (or dismisses that banner for the session).
                if (appUpdate.phase === 'available') {
                  try {
                    localStorage.setItem('sideboard.dismissedUpdateVersion', appUpdate.version);
                  } catch {
                    /* ignore */
                  }
                }
                setAppUpdate(null);
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <TeamToastStack
        toasts={teamToasts}
        onDismiss={dismissTeamToast}
      />
    </div>
  );
}
