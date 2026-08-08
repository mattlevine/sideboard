import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
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
import { OrchestratorPanel } from './components/OrchestratorPanel';
import { GlobalBoard } from './components/GlobalBoard';
import { RightSidebar } from './components/RightSidebar';
import { SidebarToggle } from './components/SidebarToggle';
import { SettingsModal } from './components/SettingsModal';
import { PanelResizeHandle } from './components/PanelResizeHandle';
import { TeamToastStack, type TeamToastItem } from './components/TeamToast';
import { GLOBAL_WORKSPACE_ID, isGlobalThread } from './lib/global-workspace';
import { normalizePreviewUrl } from './lib/preview-url';

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

  function openFile(path: string, opts?: { view?: 'edit' | 'diff' }) {
    if (opts?.view === 'diff') {
      setChangesOpen(true);
      setChangesPath(path);
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
  }

  function selectChangesTab() {
    setChangesOpen(true);
    setOpenFilePath(null);
    setOpenUrl(null);
  }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialNav, setSettingsInitialNav] = useState<
    'account' | 'agents' | 'environment' | 'advanced' | 'history'
  >('agents');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() =>
    readSidebarPref('sideboard.leftSidebar', true),
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() =>
    readSidebarPref('sideboard.rightSidebar', true),
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
    readSidebarWidth(
      'sideboard.rightSidebarWidth',
      RIGHT_SIDEBAR_DEFAULT,
      RIGHT_SIDEBAR_MIN,
      RIGHT_SIDEBAR_MAX,
    ),
  );

  const persistLeftSidebarWidth = useCallback((width: number) => {
    writeSidebarWidth('sideboard.leftSidebarWidth', width);
  }, []);

  const persistRightSidebarWidth = useCallback((width: number) => {
    writeSidebarWidth('sideboard.rightSidebarWidth', width);
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

  function toggleRightSidebar() {
    setRightSidebarOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem('sideboard.rightSidebar', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  const closeRightSidebarIfOpen = useCallback(() => {
    setRightSidebarOpen((v) => {
      if (!v) return v;
      try {
        localStorage.setItem('sideboard.rightSidebar', '0');
      } catch {
        // ignore
      }
      return false;
    });
  }, []);

  const openRightSidebarIfClosed = useCallback(() => {
    setRightSidebarOpen((v) => {
      if (v) return v;
      try {
        localStorage.setItem('sideboard.rightSidebar', '1');
      } catch {
        // ignore
      }
      return true;
    });
  }, []);

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
      setSettingsInitialNav('agents');
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

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? archived.find((t) => t.id === selectedId) ?? null,
    [threads, archived, selectedId],
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

  function onSelect(id: string, multi: boolean) {
    setView('thread');
    setSelectedId(id);
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

  async function archiveThreadAndRefresh(id: string) {
    setArchivingId(id);
    try {
      await window.sideboard.archiveThread(id);
      if (selectedId === id || multiSelected.has(id)) {
        setSelectedId(null);
        setMultiSelected(new Set());
        setView('board');
      }
      await refresh();
    } finally {
      setArchivingId(null);
    }
  }

  async function removeWorkspaceAndRefresh(path: string) {
    const inWorkspace = threads.filter((t) => t.repoPath === path);
    for (const t of inWorkspace) {
      setArchivingId(t.id);
      try {
        await window.sideboard.archiveThread(t.id);
      } finally {
        setArchivingId(null);
      }
    }
    await window.sideboard.removeWorkspace(path);
    if (repoPath === path || path === '/') {
      setRepoPath('');
      try {
        await window.sideboard.setRepoPath('');
      } catch {
        // ignore
      }
    }
    const removedIds = new Set(inWorkspace.map((t) => t.id));
    if (selectedId && removedIds.has(selectedId)) {
      setSelectedId(null);
      setView('board');
    }
    setMultiSelected((prev) => {
      const next = new Set([...prev].filter((id) => !removedIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    await refreshWorkspaces();
    await refresh();
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
            onArchive={archiveThreadAndRefresh}
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
            showRightSidebar && rightSidebarOpen ? ' has-right' : ''
          }`}
        >
          {(() => {
            const leftToggle = !leftSidebarOpen ? (
              <SidebarToggle side="left" open={false} onClick={toggleLeftSidebar} />
            ) : undefined;
            const rightToggle = showRightSidebar ? (
              <SidebarToggle
                side="right"
                open={rightSidebarOpen}
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
              composerPrefill: prefill,
              onComposerPrefillConsumed: () => setPrefill(undefined),
              leftSidebarToggle: leftToggle,
              rightSidebarToggle: rightToggle,
              onOpenThreadLink: openThreadByRef,
              onRightColumnOpen: closeRightSidebarIfOpen,
              onRightColumnClose: openRightSidebarIfClosed,
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
          {showRightSidebar && rightSidebarOpen && (
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
                thread={selected}
                onRefresh={() => void refresh()}
                onArchiveThread={archiveThreadAndRefresh}
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
      {view === 'thread' && !selected && (
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
          onCreated={(thread, opts) => {
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
            setSettingsInitialNav('agents');
            setSelectedId(id);
            setView('thread');
            setMultiSelected(new Set([id]));
          }}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsInitialNav('agents');
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
