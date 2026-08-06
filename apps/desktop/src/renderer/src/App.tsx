import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  MessagePart,
  OrchestratorEvent,
  OrchestratorRuntime,
  Thread,
  Workspace,
} from '@sideboard/core';
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
import { isGlobalThread } from './lib/global-workspace';

const LEFT_SIDEBAR_DEFAULT = 280;
const RIGHT_SIDEBAR_DEFAULT = 340;
const LEFT_SIDEBAR_MIN = 180;
const LEFT_SIDEBAR_MAX = 480;
const RIGHT_SIDEBAR_MIN = 240;
const RIGHT_SIDEBAR_MAX = 560;

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
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [liveByThread, setLiveByThread] = useState<Record<string, string>>({});
  const [livePartsByThread, setLivePartsByThread] = useState<Record<string, MessagePart[]>>({});
  const [turnStartedAtByThread, setTurnStartedAtByThread] = useState<Record<string, number>>({});
  const [runtime, setRuntime] = useState<OrchestratorRuntime | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>();
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [openFileView, setOpenFileView] = useState<'edit' | 'diff'>('edit');
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
      setOpenFileView('diff');
      return;
    }
    setChangesOpen(false);
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

  function closeChanges() {
    setChangesOpen(false);
    setChangesPath(null);
  }

  function selectChangesTab() {
    setChangesOpen(true);
    setOpenFilePath(null);
  }
  const [pendingLand, setPendingLand] = useState<{ draft?: boolean; web?: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialNav, setSettingsInitialNav] = useState<
    'account' | 'agents' | 'environment' | 'advanced'
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

  const refresh = useCallback(async () => {
    const [all, rt] = await Promise.all([
      window.sideboard.getThreads(true),
      window.sideboard.getRuntime(),
    ]);
    setThreads(all.filter((t) => t.status !== 'archived'));
    setArchived(all.filter((t) => t.status === 'archived'));
    setRuntime(rt);
  }, []);

  const upsertThread = useCallback((thread: Thread) => {
    setThreads((prev) => [...prev.filter((t) => t.id !== thread.id), thread]);
  }, []);

  const openForkedTab = useCallback(
    (created: Thread) => {
      upsertThread(created);
      setSelectedId(created.id);
      setView('thread');
      setMultiSelected(new Set([created.id]));
      void refresh();
    },
    [refresh, upsertThread],
  );

  useEffect(() => {
    void window.sideboard.getRepoPath().then(async (p) => {
      setRepoPath(p);
      if (p) {
        try {
          await window.sideboard.addWorkspace(p);
        } catch {
          // ignore
        }
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
    const offUpdate = window.sideboardUpdate.onReady(() => setUpdateReady(true));
    return () => {
      offThreads();
      offEvents();
      offUpdate();
    };
  }, [refresh]);

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? archived.find((t) => t.id === selectedId) ?? null,
    [threads, archived, selectedId],
  );

  // File tabs are scoped to the active worktree.
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
    for (const t of threads) {
      if (!t.repoPath || byPath.has(t.repoPath)) continue;
      const name = t.repoPath.split('/').filter(Boolean).pop() || t.repoPath;
      byPath.set(t.repoPath, {
        path: t.repoPath,
        name,
        addedAt: t.createdAt,
      });
    }
    if (repoPath && !byPath.has(repoPath)) {
      const name = repoPath.split('/').filter(Boolean).pop() || repoPath;
      byPath.set(repoPath, {
        path: repoPath,
        name,
        addedAt: new Date().toISOString(),
      });
    }
    return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [threads, repoPath]);

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
    setCreateState({ repoPath: forRepo ?? null, mode });
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
            archived={archived}
            selectedId={selectedId}
            view={view}
            multiSelected={multiSelected}
            repoPath={repoPath}
            onShowBoard={showBoard}
            onSelect={onSelect}
            onNew={(path, mode) => openCreate(path, mode ?? 'quick')}
            onPickRepo={() =>
              void window.sideboard.pickRepoPath().then(async (p) => {
                if (!p) return;
                setRepoPath(p);
                await window.sideboard.addWorkspace(p);
                await refresh();
              })
            }
            onRestore={(id) => void window.sideboard.restoreThread(id).then(refresh)}
            onCreatePr={(id, opts) => {
              setSelectedId(id);
              setView('thread');
              setMultiSelected(new Set([id]));
              setPendingLand(opts ?? {});
            }}
            onForkChat={(id) => {
              const t = threads.find((x) => x.id === id);
              void window.sideboard
                .forkChatTab({
                  threadId: id,
                  throughIndex: Math.max(0, (t?.messages.length ?? 1) - 1),
                })
                .then(openForkedTab)
                .catch(alert);
            }}
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
              liveParts: livePartsByThread[selected.id] ?? [],
              turnStartedAt: turnStartedAtByThread[selected.id],
              onRefresh: () => void refresh(),
              onSelectChat: (id: string, created?: Thread) => {
                if (created) upsertThread(created);
                setSelectedId(id);
                setMultiSelected(new Set([id]));
              },
              composerPrefill: prefill,
              onComposerPrefillConsumed: () => setPrefill(undefined),
              leftSidebarToggle: leftToggle,
              rightSidebarToggle: rightToggle,
              onOpenThreadLink: openThreadByRef,
            };
            return selected.sourceType === 'orchestration' || isGlobalThread(selected) ? (
            <OrchestratorPanel
              thread={selected}
              childThreads={children}
              worktreeChats={worktreeChats}
              liveOutput={liveByThread[selected.id] ?? ''}
              liveParts={livePartsByThread[selected.id] ?? []}
              turnStartedAt={turnStartedAtByThread[selected.id]}
              onRefresh={() => void refresh()}
              onSelectChild={(id) => {
                setSelectedId(id);
                setView('thread');
                setMultiSelected(new Set([id]));
              }}
              onSelectChat={(id, created) => {
                if (created) upsertThread(created);
                setSelectedId(id);
                setMultiSelected(new Set([id]));
              }}
              composerPrefill={prefill}
              onComposerPrefillConsumed={() => setPrefill(undefined)}
              leftSidebarToggle={leftToggle}
              rightSidebarToggle={rightToggle}
              onOpenThreadLink={openThreadByRef}
            />
          ) : (
            <ThreadPanel
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
              onShowChat={() => {
                setOpenFilePath(null);
                setChangesOpen(false);
              }}
              fileChanges={fileChanges}
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
                openFilePath={openFilePath}
                changesPath={changesPath}
                onOpenFile={openFile}
                onFileChanges={onFileChanges}
                onSelectChat={(id, created) => {
                  if (created) upsertThread(created);
                  setSelectedId(id);
                  setMultiSelected(new Set([id]));
                }}
                onAskAboutFile={(path) =>
                  setPrefill(`Look at the changes in ${path} and suggest next steps.`)
                }
                onForkWorktree={() =>
                  void window.sideboard
                    .forkThreadWorktree({
                      threadId: selected.id,
                      throughIndex: Math.max(0, selected.messages.length - 1),
                    })
                    .then(openForkedTab)
                    .catch(alert)
                }
                pendingLand={pendingLand}
                onPendingLandConsumed={() => setPendingLand(null)}
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
          onOpenAccount={() => {
            setCreateState(null);
            setSettingsOpen(true);
            setSettingsInitialNav('account');
          }}
          onCreated={(id, opts) => {
            void refresh();
            if (opts?.stayOpen) return;
            setSelectedId(id);
            setView('thread');
            setMultiSelected(new Set([id]));
          }}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          initialNav={settingsInitialNav}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsInitialNav('agents');
          }}
        />
      )}

      {updateReady && (
        <div className="update-banner">
          <span>Update ready</span>
          <button className="primary" onClick={() => void window.sideboardUpdate.install()}>
            Restart to update
          </button>
        </div>
      )}
    </div>
  );
}
