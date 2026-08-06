import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentKind, MessagePart, Thread, ThreadAttachment } from '@sideboard/core';
import { decodeBrightsyTarget, type BrightsyChatTargets } from '@sideboard/brightsy-targets';
import { formatTokenCount, sumUsage, totalTokens, usageTooltip } from '../lib/tokens';
import { AgentMessage } from './AgentMessage';
import { BrightsyTargetPicker } from './BrightsyTargetPicker';
import { ChatTabs } from './ChatTabs';
import { ConfirmDialog } from './ConfirmDialog';
import { ActivityMark } from './ActivityMark';
import { ThinkingIndicator } from './ThinkingIndicator';
import {
  applyAutocomplete,
  ComposerAutocomplete,
  getAutocompleteQuery,
  type AutocompleteItem,
} from './ComposerAutocomplete';
import { LinkIssuePicker, LinkWorkspacePicker } from './ComposerLinkPickers';
import { FileEditor } from './FileEditor';
import { FloatingMenu } from './FloatingMenu';
import { MarkdownMessage } from './MarkdownMessage';
import { UrlPreview } from './UrlPreview';
import { closeChatTabMessage } from '../lib/close-chat-tab';
import { isCloudCoordinatorThread, isGlobalThread } from '../lib/global-workspace';

function attachmentIconLabel(kind: ThreadAttachment['kind']): string {
  switch (kind) {
    case 'issue':
      return 'ISS';
    case 'workspace':
      return 'WS';
    case 'file':
      return 'FILE';
    default:
      return 'MD';
  }
}

interface Props {
  thread: Thread;
  worktreeChats: Thread[];
  liveOutput: string;
  liveParts?: MessagePart[];
  turnStartedAt?: number;
  onRefresh: () => void;
  onSelectChat: (id: string, created?: Thread) => void;
  composerPrefill?: string;
  onComposerPrefillConsumed?: () => void;
  openFilePath?: string | null;
  openFiles?: string[];
  openFileView?: 'edit' | 'diff';
  openUrls?: string[];
  openUrl?: string | null;
  /** Dedicated Changes center tab (file list selection, not a basename tab). */
  changesOpen?: boolean;
  changesPath?: string | null;
  onSelectFile?: (path: string, opts?: { view?: 'edit' | 'diff' }) => void;
  onCloseFile?: (path: string) => void;
  onOpenUrl?: (url: string) => void;
  onSelectUrl?: (url: string) => void;
  onCloseUrl?: (url: string) => void;
  onNavigateUrl?: (from: string, to: string) => void;
  onSelectChanges?: () => void;
  onCloseChanges?: () => void;
  onShowChat?: () => void;
  /** Open another thread from a sideboard://thread/<id> markdown link. */
  onOpenThreadLink?: (threadRef: string) => void;
  /** Git markers for open file tabs (from getDiff). */
  fileChanges?: Record<string, { status: string; additions?: number; deletions?: number }>;
  leftSidebarToggle?: ReactNode;
  rightSidebarToggle?: ReactNode;
}

export function ThreadPanel({
  thread,
  worktreeChats,
  liveOutput,
  liveParts = [],
  turnStartedAt,
  onRefresh,
  onSelectChat,
  composerPrefill,
  onComposerPrefillConsumed,
  openFilePath = null,
  openFiles = [],
  openFileView = 'edit',
  openUrls = [],
  openUrl = null,
  changesOpen = false,
  changesPath = null,
  onSelectFile,
  onCloseFile,
  onOpenUrl,
  onSelectUrl,
  onCloseUrl,
  onNavigateUrl,
  onSelectChanges,
  onCloseChanges,
  onShowChat,
  onOpenThreadLink,
  fileChanges = {},
  leftSidebarToggle,
  rightSidebarToggle,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [brightsyPickerOpen, setBrightsyPickerOpen] = useState(false);
  const [brightsyTargets, setBrightsyTargets] = useState<BrightsyChatTargets | null>(null);
  const [openMenu, setOpenMenu] = useState(false);
  const [issuePickerOpen, setIssuePickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [skills, setSkills] = useState<
    Array<{ id: string; name: string; command: string; description: string; source: string }>
  >([]);
  const [acIndex, setAcIndex] = useState(0);
  const [acSuppressed, setAcSuppressed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [closeConfirm, setCloseConfirm] = useState<{
    id: string;
    title: string;
    chatCount: number;
  } | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const acRef = useRef<HTMLDivElement>(null);
  const composerBoxRef = useRef<HTMLDivElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const composerExpanded =
    composerFocused ||
    Boolean(prompt.trim()) ||
    plusOpen ||
    modelOpen ||
    brightsyPickerOpen ||
    issuePickerOpen ||
    workspacePickerOpen ||
    (thread.attachments?.length ?? 0) > 0;

  const acQuery = useMemo(() => getAutocompleteQuery(prompt, cursor), [prompt, cursor]);
  const acItems: AutocompleteItem[] = useMemo(() => {
    if (!acQuery || acSuppressed) return [];
    if (acQuery.kind === 'file') {
      return filePaths
        .filter((p) => p.toLowerCase().includes(acQuery.query))
        .slice(0, 10)
        .map((p) => ({
          id: `file:${p}`,
          label: p,
          insert: `@${p} `,
          kind: 'file' as const,
        }));
    }
    return skills
      .filter(
        (s) =>
          s.command.includes(acQuery.query) ||
          s.name.toLowerCase().includes(acQuery.query),
      )
      .slice(0, 10)
      .map((s) => ({
        id: s.id,
        label: `/${s.command}`,
        detail: `${s.description || s.name} · ${s.source}`,
        insert: `/${s.command} `,
        kind: 'skill' as const,
      }));
  }, [acQuery, acSuppressed, filePaths, skills]);

  useEffect(() => {
    setAcIndex(0);
    setAcSuppressed(false);
  }, [acQuery?.kind, acQuery?.query]);

  const modelLabel = useMemo(() => {
    if (thread.agent === 'brightsy') {
      const target = decodeBrightsyTarget(thread.model);
      const team =
        brightsyTargets?.teams.find((t) => t.accountId === target.accountId) ??
        null;
      const poolAgents = team?.agents ?? brightsyTargets?.agents ?? [];
      const poolModels = team?.models ?? brightsyTargets?.models ?? [];
      const fromList =
        target.type === 'agent'
          ? poolAgents.find((a) => a.id === target.id)
          : poolModels.find((m) => m.id === target.id);
      const teamLabel =
        team?.accountSlug ||
        fromList?.accountSlug ||
        (target.accountId ? target.accountId.slice(0, 6) : null);
      const name =
        fromList?.name ||
        (target.type === 'agent' && target.id === 'default'
          ? 'Default'
          : target.type === 'model'
            ? target.id
            : target.id.slice(0, 8));
      return teamLabel ? `Brightsy · ${teamLabel} · ${name}` : `Brightsy · ${name}`;
    }
    if (thread.agent !== 'claude') return thread.agent;
    if (!thread.model) return 'Auto';
    const labels: Record<string, string> = {
      fable: 'Fable',
      opus: 'Opus',
      sonnet: 'Sonnet',
      haiku: 'Haiku',
    };
    return labels[thread.model] ?? thread.model;
  }, [thread.agent, thread.model, brightsyTargets]);

  // Warm the label cache when Brightsy is active so the chip shows a name.
  useEffect(() => {
    if (thread.agent !== 'brightsy' || brightsyTargets) return;
    let cancelled = false;
    void window.sideboard
      .listBrightsyChatTargets()
      .then((targets) => {
        if (!cancelled) setBrightsyTargets(targets);
      })
      .catch(() => {
        // Chip falls back to id; picker loads its own copy.
      });
    return () => {
      cancelled = true;
    };
  }, [thread.agent, brightsyTargets]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.sideboard.listFiles(thread.id),
      window.sideboard.listSkills(thread.id),
    ])
      .then(([files, skillList]) => {
        if (cancelled) return;
        setFilePaths(files);
        setSkills(skillList);
      })
      .catch(() => {
        if (!cancelled) {
          setFilePaths([]);
          setSkills([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [thread.id, thread.updatedAt]);

  useEffect(() => {
    if (composerPrefill) {
      setPrompt(composerPrefill);
      setComposerFocused(true);
      onComposerPrefillConsumed?.();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [composerPrefill, onComposerPrefillConsumed]);

  // Focus the message input whenever this chat becomes active (open / switch tab).
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [thread.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.messages, liveOutput, liveParts, pendingUser]);

  useEffect(() => {
    if (!pendingUser) return;
    const matched = thread.messages.some(
      (m) => m.role === 'user' && m.text === pendingUser,
    );
    if (matched) setPendingUser(null);
  }, [thread.messages, pendingUser]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void window.sideboard.openWorktree(thread.id, 'cursor');
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setComposerFocused(true);
        textareaRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        void addAttachmentsFromPicker();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setPlusOpen(false);
        setWorkspacePickerOpen(false);
        setIssuePickerOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [thread.id]);

  function patchOptions(patch: Parameters<typeof window.sideboard.setThreadOptions>[1]) {
    void window.sideboard.setThreadOptions(thread.id, patch).then(onRefresh);
  }

  /** Toggle a chip without collapsing the composer (blur would otherwise minimize it). */
  function toggleComposerOption(patch: Parameters<typeof window.sideboard.setThreadOptions>[1]) {
    setComposerFocused(true);
    patchOptions(patch);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const showStreaming =
    Boolean(liveOutput) ||
    liveParts.length > 0 ||
    thread.status === 'running' ||
    (thread.status === 'queued' && Boolean(pendingUser));

  function pickAutocomplete(item: AutocompleteItem) {
    if (!acQuery) return;
    const next = applyAutocomplete(prompt, acQuery.start, acQuery.end, item.insert);
    setPrompt(next.value);
    setCursor(next.cursor);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
    });
  }

  const agentActive = thread.status === 'running' || thread.status === 'queued';

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setPendingUser(text);
    setPrompt('');
    setCursor(0);
    try {
      await window.sideboard.sendToThread(thread.id, text);
      onRefresh();
    } catch (err) {
      setPendingUser(null);
      setPrompt(text);
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stopAgent() {
    try {
      await window.sideboard.stopThread(thread.id);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function implementPlan() {
    if (busy) return;
    await window.sideboard.setThreadOptions(thread.id, { planMode: false });
    setBusy(true);
    const text = 'Implement the plan above.';
    setPendingUser(text);
    try {
      await window.sideboard.sendToThread(thread.id, text);
      onRefresh();
    } catch (err) {
      setPendingUser(null);
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function newTab(agent?: AgentKind) {
    const t = await window.sideboard.createChatTab({
      fromThreadId: thread.id,
      agent,
    });
    onSelectChat(t.id, t);
    onRefresh();
  }

  async function forkToTab(throughIndex: number) {
    const t = await window.sideboard.forkChatTab({
      threadId: thread.id,
      throughIndex,
    });
    onSelectChat(t.id, t);
    onRefresh();
  }

  async function removeAttachment(id: string) {
    const next = (thread.attachments ?? []).filter((a) => a.id !== id);
    await window.sideboard.setAttachments(thread.id, next);
    onRefresh();
  }

  async function appendAttachments(extra: ThreadAttachment[]) {
    if (extra.length === 0) return;
    const latest = await window.sideboard.getThread(thread.id);
    const next = [...(latest?.attachments ?? thread.attachments ?? []), ...extra];
    await window.sideboard.setAttachments(thread.id, next);
    onRefresh();
    setComposerFocused(true);
  }

  async function addAttachmentsFromPicker() {
    setPlusOpen(false);
    const files = await window.sideboard.pickFiles();
    await appendAttachments(files);
  }

  const chats = worktreeChats.length > 0 ? worktreeChats : [thread];
  const attachments = thread.attachments ?? [];

  async function archiveChatTab(id: string) {
    await window.sideboard.archiveThread(id);
    onRefresh();
    if (id === thread.id) {
      const rest = chats.filter((c) => c.id !== id);
      if (rest[0]) onSelectChat(rest[0].id);
    }
  }
  const threadUsage = useMemo(
    () => sumUsage(thread.messages.map((m) => m.usage)),
    [thread.messages],
  );

  return (
    <section className="panel thread-main">
      <ChatTabs
        chats={chats}
        activeChatId={thread.id}
        openFiles={openFiles}
        activeFilePath={openFilePath}
        openUrls={openUrls}
        activeUrl={openUrl}
        changesOpen={changesOpen}
        changesActive={changesOpen && !openFilePath && !openUrl}
        changesCount={Object.keys(fileChanges).length}
        fileChanges={fileChanges}
        leftSidebarToggle={leftSidebarToggle}
        rightSidebarToggle={rightSidebarToggle}
        statusBadge={
          thread.status === 'running' || thread.status === 'queued' ? thread.status : null
        }
        usageTotalLabel={threadUsage ? `Σ ${formatTokenCount(totalTokens(threadUsage))} tok` : null}
        usageTotalTooltip={threadUsage ? `Thread total — ${usageTooltip(threadUsage)}` : undefined}
        openMenu={
          isGlobalThread(thread) ? undefined : (
            <>
              <button
                ref={openBtnRef}
                type="button"
                className="chat-tab-open"
                title="Open worktree"
                onClick={() => setOpenMenu((v) => !v)}
              >
                <span className="open-cube" aria-hidden />
                <span className="open-caret">▾</span>
              </button>
              <FloatingMenu
                open={openMenu}
                onClose={() => setOpenMenu(false)}
                anchorRef={openBtnRef}
                align="right"
                minWidth={220}
              >
                {(
                  [
                    { id: 'finder' as const, label: 'Finder', kbd: '1' },
                    { id: 'cursor' as const, label: 'Cursor', kbd: '⌘O' },
                    { id: 'code' as const, label: 'VS Code', kbd: '3' },
                    { id: 'xcode' as const, label: 'Xcode', kbd: '4' },
                    { id: 'terminal' as const, label: 'Terminal', kbd: '5' },
                    { id: 'datagrip' as const, label: 'DataGrip', kbd: '6' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setOpenMenu(false);
                      void window.sideboard.openWorktree(thread.id, item.id).catch(alert);
                    }}
                  >
                    <span>{item.label}</span>
                    <kbd>{item.kbd}</kbd>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(false);
                    void navigator.clipboard?.writeText(thread.worktreePath);
                  }}
                >
                  <span>Copy path</span>
                  <kbd>7</kbd>
                </button>
              </FloatingMenu>
            </>
          )
        }
        onSelectChat={(id) => {
          onShowChat?.();
          onSelectChat(id);
        }}
        onSelectFile={(path) => onSelectFile?.(path)}
        onCloseFile={(path) => onCloseFile?.(path)}
        onSelectUrl={(url) => onSelectUrl?.(url)}
        onCloseUrl={(url) => onCloseUrl?.(url)}
        onSelectChanges={() => onSelectChanges?.()}
        onCloseChanges={() => onCloseChanges?.()}
        onNewTab={(agent) => void newTab(agent)}
        onRename={(id, title) =>
          void window.sideboard.renameThread(id, title).then(onRefresh)
        }
        onCloseTab={(id) => {
          const tab = chats.find((c) => c.id === id);
          if (!tab) return;
          setCloseConfirm({ id, title: tab.title, chatCount: chats.length });
        }}
      />

      {closeConfirm && (
        <ConfirmDialog
          title="Close chat tab?"
          message={closeChatTabMessage(closeConfirm.title, closeConfirm.chatCount)}
          confirmLabel="Close tab"
          busy={closeBusy}
          busyMessage={
            closeConfirm.chatCount <= 1
              ? 'Stopping agents and removing the worktree…'
              : 'Closing this chat tab…'
          }
          onConfirm={() => {
            const { id } = closeConfirm;
            setCloseBusy(true);
            void archiveChatTab(id)
              .then(() => {
                setCloseConfirm(null);
              })
              .catch((err: unknown) => {
                window.alert(err instanceof Error ? err.message : String(err));
              })
              .finally(() => {
                setCloseBusy(false);
              });
          }}
          onCancel={() => {
            if (!closeBusy) setCloseConfirm(null);
          }}
        />
      )}

      {changesOpen && changesPath ? (
        <FileEditor
          key={`changes:${changesPath}`}
          threadId={thread.id}
          path={changesPath}
          worktreePath={thread.worktreePath}
          initialView="diff"
          onClose={() => onCloseChanges?.()}
          onSaved={onRefresh}
        />
      ) : openUrl ? (
        <UrlPreview
          key={openUrl}
          url={openUrl}
          onNavigate={(to) => onNavigateUrl?.(openUrl, to)}
          onClose={() => onCloseUrl?.(openUrl)}
        />
      ) : openFilePath ? (
        <FileEditor
          threadId={thread.id}
          path={openFilePath}
          worktreePath={thread.worktreePath}
          initialView={openFileView}
          onClose={() => onCloseFile?.(openFilePath)}
          onSaved={onRefresh}
        />
      ) : (
        <div className="chat">
          {thread.messages.length === 0 &&
            !pendingUser &&
            !showStreaming &&
            !thread.lastError && (
              <div className="chat-empty">
                <div className="chat-empty-mark" aria-hidden>
                  <span className="chat-empty-cube" />
                </div>
                {thread.sourceType === 'orchestration' || isGlobalThread(thread) ? (
                  <>
                    <h3>What should we orchestrate?</h3>
                    <p>
                      {isGlobalThread(thread)
                        ? isCloudCoordinatorThread(thread)
                          ? 'Steer worktree agents across registered repos. Brightsy cloud requests land in this chat.'
                          : 'Steer worktree agents across registered repos with Sideboard MCP.'
                        : 'Coordinate child worktree agents from this orchestration chat.'}{' '}
                      Use <kbd>⌘L</kbd> to focus the composer.
                    </p>
                  </>
                ) : (
                  <>
                    <h3>What are you working on?</h3>
                    <p>
                      Ask Sideboard to explore this worktree, make changes, or summarize a PR. Use{' '}
                      <kbd>⌘L</kbd> to focus the composer.
                    </p>
                  </>
                )}
              </div>
            )}
          {thread.messages.map((m, i) => {
            const prevUser = [...thread.messages.slice(0, i)]
              .reverse()
              .find((x) => x.role === 'user');
            const fallbackDuration =
              m.role === 'agent' && prevUser
                ? Math.max(0, new Date(m.ts).getTime() - new Date(prevUser.ts).getTime())
                : undefined;
            return (
              <div key={`${m.ts}-${i}`} className={`msg ${m.role}`}>
                {m.role === 'agent' ? (
                  <AgentMessage
                    text={m.text}
                    parts={m.parts}
                    ts={m.ts}
                    durationMs={m.durationMs ?? fallbackDuration}
                    usage={m.usage}
                    threadId={thread.id}
                    worktreePath={thread.worktreePath}
                    knownFilePaths={filePaths}
                    onOpenFile={onSelectFile}
                    onOpenUrl={onOpenUrl}
                    onOpenThread={onOpenThreadLink}
                    onFork={() => void forkToTab(i)}
                  />
                ) : m.role === 'summary' ? (
                  <div className="msg-summary">
                    <div className="msg-summary-label">Context summarized</div>
                    <MarkdownMessage
                      text={m.text}
                      onThreadLinkClick={onOpenThreadLink}
                      onUrlClick={onOpenUrl}
                    />
                  </div>
                ) : (
                  <div className="msg-body">{m.text}</div>
                )}
              </div>
            );
          })}
          {pendingUser &&
            !thread.messages.some((m) => m.role === 'user' && m.text === pendingUser) && (
              <div className="msg user pending">{pendingUser}</div>
            )}
          {showStreaming && (
            <>
              <div
                className={`msg agent streaming${liveOutput || liveParts.length ? '' : ' waiting'}`}
              >
                {liveOutput || liveParts.length || turnStartedAt ? (
                  <AgentMessage
                    text={liveOutput}
                    parts={liveParts}
                    streaming
                    startedAt={turnStartedAt}
                    threadId={thread.id}
                    worktreePath={thread.worktreePath}
                    knownFilePaths={filePaths}
                    onOpenFile={onSelectFile}
                    onOpenUrl={onOpenUrl}
                    onOpenThread={onOpenThreadLink}
                    onFork={() => void forkToTab(Math.max(0, thread.messages.length - 1))}
                  />
                ) : (
                  <ThinkingIndicator
                    queued={thread.status === 'queued'}
                    showMark={false}
                  />
                )}
              </div>
              <div
                className="msg-stream-activity"
                aria-live="polite"
                aria-label="Generating"
              >
                <ActivityMark
                  tone={thread.status === 'queued' ? 'queued' : 'active'}
                  size="sm"
                />
                <span className="thinking-indicator-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </>
          )}
          {thread.lastError && (
            <div className="msg error" style={{ color: 'var(--err)' }}>
              {thread.lastError}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <div
        className={`composer-shell${openFilePath || openUrl || changesOpen ? ' overlay' : ''}${composerExpanded ? ' expanded' : ' collapsed'}`}
      >
        <div
          ref={composerBoxRef}
          className={`composer-box${composerExpanded ? ' expanded' : ' collapsed'}`}
          onClick={() => {
            if (!composerExpanded) textareaRef.current?.focus();
          }}
        >
          {thread.planMode && !openFilePath && !openUrl && !changesOpen && (
            <div className="composer-plan-banner">
              Plan mode stays on until you turn it off or click Implement.
            </div>
          )}
          {attachments.length > 0 && (
            <div className="composer-attachments">
              {attachments.map((a) => (
                <span key={a.id} className="attachment-chip" title={a.kind}>
                  <span className={`attachment-icon kind-${a.kind}`}>
                    {attachmentIconLabel(a.kind)}
                  </span>
                  <span className="attachment-name">{a.name}</span>
                  <button
                    type="button"
                    className="attachment-remove"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeAttachment(a.id);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="composer-input-row" ref={acRef}>
            <span className="composer-cube" aria-hidden />
            {acItems.length > 0 && (
              <ComposerAutocomplete
                items={acItems}
                activeIndex={Math.min(acIndex, acItems.length - 1)}
                onHover={setAcIndex}
                onPick={pickAutocomplete}
              />
            )}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setCursor(e.target.selectionStart);
              }}
              onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
              onClick={(e) => setCursor(e.currentTarget.selectionStart)}
              onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
              rows={composerExpanded ? 3 : 1}
              placeholder={
                thread.status === 'running' || thread.status === 'queued'
                  ? 'Queued when you send…'
                  : thread.planMode
                    ? 'Plan mode — agent will analyze and plan without editing files'
                    : thread.sourceType === 'orchestration' || isGlobalThread(thread)
                      ? 'Describe a goal — spawn and steer worktree agents via MCP'
                      : 'Ask to make changes, @mention files, run /commands'
              }
              onFocus={() => setComposerFocused(true)}
              onBlur={() => {
                // Delay so toolbar / autocomplete clicks can run first
                window.setTimeout(() => {
                  const active = document.activeElement;
                  if (composerBoxRef.current?.contains(active)) return;
                  if (acRef.current?.contains(active)) return;
                  setComposerFocused(false);
                }, 0);
              }}
              onKeyDown={(e) => {
                if (acItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setAcIndex((i) => (i + 1) % acItems.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setAcIndex((i) => (i - 1 + acItems.length) % acItems.length);
                    return;
                  }
                  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                    e.preventDefault();
                    const item = acItems[Math.min(acIndex, acItems.length - 1)];
                    if (item) pickAutocomplete(item);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setAcSuppressed(true);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
                if (e.key === 'Escape') {
                  e.currentTarget.blur();
                  setComposerFocused(false);
                }
              }}
            />
            {!composerExpanded && <span className="composer-focus-hint">⌘L to focus</span>}
            {!composerExpanded && agentActive && (
              <button
                type="button"
                className="stop-btn"
                title="Stop agent"
                onClick={(e) => {
                  e.stopPropagation();
                  void stopAgent();
                }}
              >
                ■
              </button>
            )}
            {!composerExpanded && !agentActive && (
              <button
                type="button"
                className="send-btn"
                disabled={busy || !prompt.trim()}
                title="Send"
                onClick={(e) => {
                  e.stopPropagation();
                  void send();
                }}
              >
                ↑
              </button>
            )}
          </div>
          {composerExpanded && (
            <div
              className="composer-toolbar"
              onMouseDown={(e) => {
                // Prevent textarea blur so toolbar toggles (Plan, Fast, etc.) don't collapse the composer.
                e.preventDefault();
              }}
            >
              <div className="composer-left">
                <button
                  ref={modelBtnRef}
                  type="button"
                  className="chip active"
                  title="Choose model / agent"
                  onClick={() => {
                    setPlusOpen(false);
                    setModelOpen((v) => !v);
                  }}
                >
                  ▦ {modelLabel}
                </button>
                <button
                  type="button"
                  className={`chip${thread.planMode ? ' active plan' : ''}`}
                  title="Plan mode — analyze and plan without editing files"
                  onClick={() => toggleComposerOption({ planMode: !thread.planMode })}
                >
                  <span className="chip-plan-icon" aria-hidden>
                    ◫
                  </span>{' '}
                  Plan
                </button>
                <button
                  type="button"
                  className={`chip${thread.fast ? ' active fast' : ''}`}
                  title="Fast mode (lower effort)"
                  onClick={() => toggleComposerOption({ fast: !thread.fast })}
                >
                  <span className="chip-bolt" aria-hidden>
                    ⚡
                  </span>{' '}
                  Fast
                </button>
                <FloatingMenu
                  open={modelOpen}
                  onClose={() => setModelOpen(false)}
                  anchorRef={modelBtnRef}
                  align="left"
                  placement="up"
                  minWidth={260}
                >
                  <div className="menu-section">Claude</div>
                  {(
                    [
                      { id: null, label: 'Auto' },
                      { id: 'fable', label: 'Fable' },
                      { id: 'opus', label: 'Opus' },
                      { id: 'sonnet', label: 'Sonnet' },
                      { id: 'haiku', label: 'Haiku' },
                    ] as const
                  ).map((m, i) => (
                    <button
                      key={m.label}
                      type="button"
                      className={
                        thread.agent === 'claude' && thread.model === m.id ? 'selected' : ''
                      }
                      onClick={() => {
                        setModelOpen(false);
                        patchOptions({ agent: 'claude', model: m.id });
                      }}
                    >
                      <span>
                        {thread.agent === 'claude' && thread.model === m.id ? '✓ ' : ''}
                        {m.label}
                      </span>
                      <kbd>{i + 1}</kbd>
                    </button>
                  ))}
                  <div className="menu-section">Agents</div>
                  <button
                    type="button"
                    className={thread.agent === 'codex' ? 'selected' : ''}
                    onClick={() => {
                      setModelOpen(false);
                      patchOptions({ agent: 'codex', model: null });
                    }}
                  >
                    <span>{thread.agent === 'codex' ? '✓ ' : ''}Codex</span>
                  </button>
                  <button
                    type="button"
                    className={thread.agent === 'opencode' ? 'selected' : ''}
                    onClick={() => {
                      setModelOpen(false);
                      patchOptions({ agent: 'opencode', model: null });
                    }}
                  >
                    <span>{thread.agent === 'opencode' ? '✓ ' : ''}OpenCode</span>
                  </button>
                  <button
                    type="button"
                    className={thread.agent === 'cursor' ? 'selected' : ''}
                    onClick={() => {
                      setModelOpen(false);
                      patchOptions({ agent: 'cursor', model: null });
                    }}
                  >
                    <span>{thread.agent === 'cursor' ? '✓ ' : ''}Cursor</span>
                  </button>
                  <button
                    type="button"
                    className={thread.agent === 'brightsy' ? 'selected' : ''}
                    onClick={() => {
                      setModelOpen(false);
                      setBrightsyPickerOpen(true);
                    }}
                  >
                    <span>{thread.agent === 'brightsy' ? '✓ ' : ''}Brightsy</span>
                    <kbd>…</kbd>
                  </button>
                  <div className="menu-section">Permissions</div>
                  <button
                    type="button"
                    className={thread.autonomy === 'default' ? 'selected' : ''}
                    onClick={() => {
                      setModelOpen(false);
                      patchOptions({ autonomy: 'default' });
                    }}
                  >
                    <span>Default permissions</span>
                  </button>
                  <button
                    type="button"
                    className={thread.autonomy === 'full' ? 'selected' : ''}
                    onClick={() => {
                      setModelOpen(false);
                      patchOptions({ autonomy: 'full' });
                    }}
                  >
                    <span>Full autonomy</span>
                  </button>
                </FloatingMenu>
              </div>
              <div className="composer-right">
                {thread.planMode && thread.messages.some((m) => m.role === 'agent') && (
                  <button
                    type="button"
                    className="chip implement-plan"
                    title="Turn off Plan mode and ask the agent to implement"
                    disabled={busy}
                    onClick={() => void implementPlan()}
                  >
                    Implement
                  </button>
                )}
                <button
                  ref={plusBtnRef}
                  type="button"
                  className="icon-round"
                  title="More"
                  onClick={() => {
                    setModelOpen(false);
                    setPlusOpen((v) => !v);
                  }}
                >
                  +
                </button>
                <FloatingMenu
                  open={plusOpen}
                  onClose={() => setPlusOpen(false)}
                  anchorRef={plusBtnRef}
                  align="right"
                  placement="up"
                  minWidth={240}
                >
                  <button
                    type="button"
                    onClick={() => {
                      void addAttachmentsFromPicker();
                    }}
                  >
                    <span className="menu-item-label">
                      <span className="tool-menu-icon paperclip" aria-hidden />
                      Add attachment
                    </span>
                    <kbd>⌘U</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      setWorkspacePickerOpen(false);
                      setIssuePickerOpen(true);
                    }}
                  >
                    <span className="menu-item-label">
                      <span className="tool-menu-icon menu-issue-icons" aria-hidden>
                        <span className="picker-logo linear tiny" />
                        <span className="picker-logo github tiny" />
                      </span>
                      Link issue
                    </span>
                    <kbd>⌘I</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      setIssuePickerOpen(false);
                      setWorkspacePickerOpen(true);
                    }}
                  >
                    <span className="menu-item-label">
                      <span className="tool-menu-icon" aria-hidden>
                        <span className="picker-folder-in" />
                      </span>
                      Link workspaces
                    </span>
                  </button>
                </FloatingMenu>
                {agentActive && (
                  <button
                    type="button"
                    className="stop-btn"
                    title="Stop agent"
                    onClick={() => void stopAgent()}
                  >
                    ■
                  </button>
                )}
                <button
                  type="button"
                  className="send-btn"
                  disabled={busy || !prompt.trim()}
                  title={agentActive ? 'Queue message' : 'Send'}
                  onClick={() => void send()}
                >
                  ↑
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <LinkIssuePicker
        open={issuePickerOpen}
        agent={thread.agent}
        repoPath={thread.repoPath}
        onClose={() => setIssuePickerOpen(false)}
        onPick={(att) => {
          void appendAttachments([att]);
        }}
      />
      <LinkWorkspacePicker
        open={workspacePickerOpen}
        onClose={() => setWorkspacePickerOpen(false)}
        onPick={(att) => {
          void appendAttachments([att]);
        }}
      />
      <BrightsyTargetPicker
        open={brightsyPickerOpen}
        currentModel={thread.agent === 'brightsy' ? thread.model : null}
        onClose={() => setBrightsyPickerOpen(false)}
        onPick={(model) => {
          patchOptions({ agent: 'brightsy', model });
          if (model) {
            // Refresh label cache after picking a less-common agent.
            void window.sideboard.listBrightsyChatTargets().then(setBrightsyTargets).catch(() => {});
          }
          // Win the race against textarea onBlur's setTimeout(0), which would
          // otherwise collapse the composer when the picker unmounts.
          setComposerFocused(true);
          window.setTimeout(() => {
            setComposerFocused(true);
            textareaRef.current?.focus();
          }, 0);
        }}
      />
    </section>
  );
}
