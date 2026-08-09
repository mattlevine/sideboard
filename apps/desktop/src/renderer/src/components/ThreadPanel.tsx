import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AgentKind, MessagePart, ThinkingEffort, Thread, ThreadAttachment } from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { decodeBrightsyTarget, type BrightsyChatTargets } from '@sideboard/brightsy-targets';
import {
  RIGHT_COLUMN_WIDTH_DEFAULT,
  RightColumnPane,
  type RightColumnFilePicker,
} from './schema/RightColumnPane';
import type { FilePickerRequest } from './schema/FileManagerColumn';
import {
  isFilesPane,
  isSchemaPane,
  latestRightPaneContent,
  type FilesPaneContent,
  type RightPaneContent,
  type SchemaPaneContent,
} from '../lib/right-pane';
import {
  getClosedRightPane,
  getRememberedRightPaneSession,
  isRightPaneSuppressed,
  rememberClosedRightPane,
  rememberRightPaneSession,
  setRightPaneSuppressed,
  type RightPaneSession,
} from '../lib/right-pane-memory';
import { formatTokenCount, sumUsage, totalTokens, usageTooltip } from '../lib/tokens';
import { AgentMessage } from './AgentMessage';
import { ChatTabs } from './ChatTabs';
import { CreateProcessingOverlay } from './CreateProcessingOverlay';
import { AgentOptionsPicker, type AgentOptionsValue } from './AgentOptionsPicker';
import { ThinkingEffortChip } from './ThinkingEffortChip';
import {
  agentModelLabel,
  cursorModelLabel,
  useAgentModels,
  useCursorModels,
} from './CursorModelMenu';
import { ActivityMark } from './ActivityMark';
import { ThinkingIndicator } from './ThinkingIndicator';
import {
  applyAutocomplete,
  ComposerAutocomplete,
  getAutocompleteQuery,
  type AutocompleteItem,
} from './ComposerAutocomplete';
import { LinkIssuePicker, LinkWorkspacePicker } from './ComposerLinkPickers';
import { ComposerAttachmentChips } from './ComposerOptionsToolbar';
import { FileEditor } from './FileEditor';
import { FloatingMenu } from './FloatingMenu';
import { MarkdownMessage } from './MarkdownMessage';
import { UrlPreview } from './UrlPreview';
import {
  canAcceptComposerFileDrop,
  composerDropSourcesFromSnapshot,
  preventComposerFileDrag,
  snapshotComposerDrop,
} from '../lib/composer-file-drop';
import { largePasteBufferFromEvent } from '../lib/paste-attachment';
import { closeChatTabMessage } from '../lib/close-chat-tab';
import { isCloudCoordinatorThread, isGlobalThread, isOrchestratorThread } from '../lib/global-workspace';
import {
  readRightColumnWidth,
  writeRightColumnWidth,
} from '../lib/panel-widths';

/** Hide lastError when the last agent bubble already shows the same limit/auth failure. */
function isRedundantLastError(thread: Thread): boolean {
  const err = thread.lastError?.trim();
  if (!err) return false;
  const lastAgent = [...thread.messages].reverse().find((m) => m.role === 'agent');
  const body = lastAgent?.text?.trim() ?? '';
  if (!body) return false;
  const lower = body.toLowerCase();
  const looksLikeLimit =
    /you've hit your|hit your (session|weekly|opus) limit|usage limit|rate.?limit|credit balance|out of credits|too many requests/.test(
      lower,
    );
  if (!looksLikeLimit) return false;
  // Bare exit code, or the same message duplicated under the bubble.
  if (/^exit\s*\d+\b/i.test(err)) return true;
  if (body.includes(err) || err.includes(body)) return true;
  return false;
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
  onSelectUrl?: (url: string) => void;
  onCloseUrl?: (url: string) => void;
  onNavigateUrl?: (from: string, to: string) => void;
  onSelectChanges?: () => void;
  onCloseChanges?: () => void;
  onShowChat?: () => void;
  /** Open another thread from a sideboard://thread/<id> markdown link. */
  onOpenThreadLink?: (threadRef: string) => void;
  /** Hide embedded BrowserView while a modal covers the app (e.g. Settings). */
  urlPreviewSuspended?: boolean;
  /** Git markers for open file tabs (from getDiff). */
  fileChanges?: Record<string, { status: string; additions?: number; deletions?: number }>;
  leftSidebarToggle?: ReactNode;
  rightSidebarToggle?: ReactNode;
}

const queuedIconStroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function QueuedIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      {children}
    </svg>
  );
}

function QueuedSendNowIcon() {
  return (
    <QueuedIcon>
      <polygon points="5 3 19 12 5 21 5 3" {...queuedIconStroke} fill="currentColor" stroke="none" />
    </QueuedIcon>
  );
}

function QueuedEditIcon() {
  return (
    <QueuedIcon>
      <path d="M12 20h9" {...queuedIconStroke} />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" {...queuedIconStroke} />
    </QueuedIcon>
  );
}

function QueuedRemoveIcon() {
  return (
    <QueuedIcon>
      <path d="M18 6 6 18M6 6l12 12" {...queuedIconStroke} />
    </QueuedIcon>
  );
}

const EMPTY_LIVE_PARTS: MessagePart[] = [];

export function ThreadPanel({
  thread,
  worktreeChats,
  liveOutput,
  liveParts = EMPTY_LIVE_PARTS,
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
  onSelectUrl,
  onCloseUrl,
  onNavigateUrl,
  onSelectChanges,
  onCloseChanges,
  onShowChat,
  onOpenThreadLink,
  urlPreviewSuspended = false,
  fileChanges = {},
  leftSidebarToggle,
  rightSidebarToggle,
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [queueEditText, setQueueEditText] = useState('');
  const [queueBusyIndex, setQueueBusyIndex] = useState<number | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [brightsyTargets, setBrightsyTargets] = useState<BrightsyChatTargets | null>(null);
  const cursorModelsEnabled = thread.agent === 'cursor';
  const { models: cursorModels } = useCursorModels(cursorModelsEnabled);
  const codexModelsEnabled = thread.agent === 'codex';
  const { models: codexModels } = useAgentModels('codex', codexModelsEnabled);
  const opencodeModelsEnabled = thread.agent === 'opencode';
  const { models: opencodeModels } = useAgentModels('opencode', opencodeModelsEnabled);
  const [openMenu, setOpenMenu] = useState(false);
  const [issuePickerOpen, setIssuePickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  /** Optimistic effort so the chip updates before refresh lands. */
  const [optimisticEffort, setOptimisticEffort] = useState<ThinkingEffort | null>(null);
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
  const [forkWorkspaceConfirm, setForkWorkspaceConfirm] = useState<{
    throughIndex: number;
  } | null>(null);
  const [forkWorkspaceBusy, setForkWorkspaceBusy] = useState(false);
  const [rightSession, setRightSession] = useState<RightPaneSession | null>(() => {
    const remembered = getRememberedRightPaneSession(thread.id);
    return remembered === undefined ? null : remembered;
  });
  const [artifactWidth, setArtifactWidth] = useState(() =>
    readRightColumnWidth(thread.worktreePath, RIGHT_COLUMN_WIDTH_DEFAULT),
  );
  const [filePicker, setFilePicker] = useState<RightColumnFilePicker | null>(null);
  /** After the user closes the pane, skip auto-open until a different artifact. */
  const suppressArtifactAutoOpen = useRef(isRightPaneSuppressed(thread.id));
  const rightPane =
    rightSession?.tabs.find((t) => t.id === rightSession.activeId) ??
    rightSession?.tabs[0] ??
    null;
  const chatRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const acRef = useRef<HTMLDivElement>(null);
  const composerBoxRef = useRef<HTMLDivElement>(null);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const composerExpanded =
    composerFocused ||
    Boolean(prompt.trim()) ||
    plusOpen ||
    agentPickerOpen ||
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

  useEffect(() => {
    setOptimisticEffort(null);
  }, [thread.id, thread.effort]);

  const displayEffort: ThinkingEffort = optimisticEffort ?? thread.effort ?? 'high';

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
    if (thread.agent === 'cursor') {
      return `Cursor · ${cursorModelLabel(thread.model, cursorModels)}`;
    }
    if (thread.agent === 'codex') {
      return `Codex · ${agentModelLabel(thread.model, codexModels, { fallback: 'Codex' })}`;
    }
    if (thread.agent === 'opencode') {
      return `OpenCode · ${agentModelLabel(thread.model, opencodeModels, { fallback: 'OpenCode' })}`;
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
  }, [
    thread.agent,
    thread.model,
    brightsyTargets,
    cursorModels,
    codexModels,
    opencodeModels,
  ]);

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

  // Reset stick-to-bottom when switching chats (show latest for the newly opened thread).
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [thread.id]);

  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = gap < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [thread.id]);

  // Scroll only this chat's overflow container — never scrollIntoView (that
  // yanks shared ancestors when another thread's live chunks re-render App).
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.messages, thread.queue, liveOutput, liveParts, pendingUser]);

  useEffect(() => {
    if (!pendingUser) return;
    const matched =
      thread.messages.some((m) => m.role === 'user' && m.text === pendingUser) ||
      thread.queue.includes(pendingUser);
    if (matched) {
      setPendingUser(null);
      setPendingAttachments([]);
    }
  }, [thread.messages, thread.queue, pendingUser]);

  useEffect(() => {
    if (editingQueueIndex === null) return;
    if (editingQueueIndex >= thread.queue.length) {
      setEditingQueueIndex(null);
      setQueueEditText('');
    }
  }, [thread.queue, editingQueueIndex]);

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
    void window.sideboard
      .setThreadOptions(thread.id, patch)
      .then(() => {
        onRefresh();
      })
      .catch((err) => {
        setOptimisticEffort(null);
        window.alert(err instanceof Error ? err.message : String(err));
      });
  }

  /** Toggle a chip without collapsing the composer (blur would otherwise minimize it). */
  function toggleComposerOption(patch: Parameters<typeof window.sideboard.setThreadOptions>[1]) {
    setComposerFocused(true);
    if (patch.effort !== undefined) setOptimisticEffort(patch.effort);
    patchOptions(patch);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  /**
   * Agent providers can't be swapped mid-conversation (session/history is
   * provider-specific). Switching after messages exist opens a new chat tab.
   * Same-provider model changes stay on this thread.
   */
  async function applyAgentOptions(next: AgentOptionsValue) {
    setComposerFocused(true);
    const sameProvider = next.agent === thread.agent;
    const midChat = thread.messages.length > 0;

    if (sameProvider) {
      setOptimisticEffort(next.effort);
      patchOptions({ model: next.model, autonomy: next.autonomy, effort: next.effort });
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (!midChat) {
      setOptimisticEffort(next.effort);
      patchOptions({
        agent: next.agent,
        model: next.model,
        autonomy: next.autonomy,
        effort: next.effort,
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    try {
      const t = await window.sideboard.createChatTab({
        fromThreadId: thread.id,
        agent: next.agent,
        model: next.model,
        autonomy: next.autonomy,
        effort: next.effort,
      });
      onSelectChat(t.id, t);
      onRefresh();
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  const showStreaming =
    Boolean(liveOutput) ||
    liveParts.length > 0 ||
    thread.status === 'running' ||
    (thread.status === 'queued' && Boolean(pendingUser));

  /** True from `turn_started` to `turn_finished` — a turn is actively in flight. */
  const turnInFlight = Boolean(turnStartedAt);
  const pendingOptimistic =
    turnInFlight &&
    pendingUser &&
    !thread.messages.some((m) => m.role === 'user' && m.text === pendingUser) &&
    !thread.queue.includes(pendingUser)
      ? pendingUser
      : null;

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
  const [pendingAttachments, setPendingAttachments] = useState<ThreadAttachment[]>(
    [],
  );

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    const snapshotAttachments = [...(thread.attachments ?? [])];
    setBusy(true);
    setPendingUser(text);
    setPendingAttachments(snapshotAttachments);
    setPrompt('');
    setCursor(0);
    suppressArtifactAutoOpen.current = false;
    try {
      await window.sideboard.sendToThread(thread.id, text);
      onRefresh();
    } catch (err) {
      setPendingUser(null);
      setPendingAttachments([]);
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

  function startEditQueued(index: number, text: string) {
    setEditingQueueIndex(index);
    setQueueEditText(text);
  }

  function cancelEditQueued() {
    setEditingQueueIndex(null);
    setQueueEditText('');
  }

  async function saveEditQueued(index: number) {
    const text = queueEditText.trim();
    if (!text) return;
    setQueueBusyIndex(index);
    try {
      await window.sideboard.editQueuedMessage(thread.id, index, text);
      onRefresh();
      setEditingQueueIndex(null);
      setQueueEditText('');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusyIndex(null);
    }
  }

  async function removeQueued(index: number) {
    setQueueBusyIndex(index);
    // Remap or clear the open editor before the queue shifts.
    if (editingQueueIndex !== null) {
      if (editingQueueIndex === index) {
        cancelEditQueued();
      } else if (editingQueueIndex > index) {
        setEditingQueueIndex(editingQueueIndex - 1);
      }
    }
    try {
      await window.sideboard.removeQueuedMessage(thread.id, index);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusyIndex(null);
    }
  }

  async function sendQueuedNow(index: number) {
    setQueueBusyIndex(index);
    // Promote reorders the queue — drop any open edit so we don't save against the wrong item.
    cancelEditQueued();
    try {
      await window.sideboard.sendQueuedMessageNow(thread.id, index);
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusyIndex(null);
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

  async function newTab(opts?: {
    agent?: AgentKind;
    model?: string | null;
    autonomy?: Thread['autonomy'];
    effort?: ThinkingEffort;
  }) {
    const t = await window.sideboard.createChatTab({
      fromThreadId: thread.id,
      agent: opts?.agent,
      model: opts?.model,
      autonomy: opts?.autonomy,
      effort: opts?.effort,
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

  const canForkWorkspace =
    !isGlobalThread(thread) &&
    thread.sourceType !== 'orchestration' &&
    Boolean(thread.repoPath && thread.branchName);

  function requestForkWorkspace(throughIndex: number) {
    if (forkWorkspaceBusy || !canForkWorkspace) return;
    setForkWorkspaceConfirm({ throughIndex });
  }

  async function confirmForkWorkspace() {
    if (!forkWorkspaceConfirm || forkWorkspaceBusy || !canForkWorkspace) return;
    const { throughIndex } = forkWorkspaceConfirm;
    setForkWorkspaceBusy(true);
    try {
      const t = await window.sideboard.forkThreadWorktree({
        threadId: thread.id,
        throughIndex,
      });
      setForkWorkspaceConfirm(null);
      // Select before clearing busy so App focuses the new workspace like CreateModal.
      onSelectChat(t.id, t);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setForkWorkspaceBusy(false);
    }
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
    const files = await window.sideboard.pickFiles(thread.id);
    await appendAttachments(files);
  }

  async function attachDroppedSnapshot(
    snap: ReturnType<typeof snapshotComposerDrop>,
  ) {
    try {
      const { absolutePaths, relativePaths, buffers } =
        await composerDropSourcesFromSnapshot(snap, thread.id);
      if (
        absolutePaths.length === 0 &&
        relativePaths.length === 0 &&
        buffers.length === 0
      ) {
        return;
      }
      const files = await window.sideboard.attachComposerFiles(thread.id, {
        absolutePaths,
        relativePaths,
        buffers,
      });
      await appendAttachments(files);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
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

  const chatViewOpen = !openFilePath && !openUrl && !changesOpen;

  function sameRightPane(a: RightPaneContent, b: RightPaneContent): boolean {
    if (isSchemaPane(a) && isSchemaPane(b)) {
      return (
        a.resourceId === b.resourceId &&
        a.datasource === b.datasource &&
        (a.recordId ?? null) === (b.recordId ?? null)
      );
    }
    if (isFilesPane(a) && isFilesPane(b)) {
      return a.datasource === b.datasource && (a.path ?? '') === (b.path ?? '');
    }
    if (
      !isSchemaPane(a) &&
      !isSchemaPane(b) &&
      !isFilesPane(a) &&
      !isFilesPane(b)
    ) {
      return a.content === b.content && a.title === b.title;
    }
    return false;
  }

  function upsertTab(
    tabs: RightPaneContent[],
    next: RightPaneContent,
  ): RightPaneSession {
    const matchIdx = tabs.findIndex(
      (t) => t.id === next.id || sameRightPane(t, next),
    );
    if (matchIdx >= 0) {
      const matchedId = tabs[matchIdx]!.id;
      const cleaned = tabs
        .filter((t) => t.id === matchedId || !sameRightPane(t, next))
        .map((t) => (t.id === matchedId ? next : t));
      return { tabs: cleaned, activeId: next.id };
    }
    return { tabs: [...tabs, next], activeId: next.id };
  }

  function openRightPane(next: RightPaneContent) {
    suppressArtifactAutoOpen.current = false;
    setRightPaneSuppressed(thread.id, false);
    setRightSession((prev) => {
      const session = upsertTab(prev?.tabs ?? [], next);
      rememberRightPaneSession(thread.id, session);
      return session;
    });
    onShowChat?.();
  }

  function closeRightTab(id: string) {
    setFilePicker((fp) => (fp?.returnTabId === id ? null : fp));
    setRightSession((prev) => {
      if (!prev) return prev;
      const closed = prev.tabs.find((t) => t.id === id) ?? null;
      const tabs = prev.tabs.filter((t) => t.id !== id);
      if (!tabs.length) {
        rememberClosedRightPane(thread.id, closed);
        suppressArtifactAutoOpen.current = true;
        rememberRightPaneSession(thread.id, null);
        return null;
      }
      const activeId =
        prev.activeId === id ? tabs[tabs.length - 1]!.id : prev.activeId;
      const session = { tabs, activeId };
      rememberRightPaneSession(thread.id, session);
      return session;
    });
  }

  function activateRightTab(id: string) {
    setRightSession((prev) => {
      if (!prev) return prev;
      const session = { ...prev, activeId: id };
      rememberRightPaneSession(thread.id, session);
      return session;
    });
  }

  function updateSchemaTab(next: SchemaPaneContent) {
    setRightSession((prev) => {
      if (!prev) {
        const session = { tabs: [next], activeId: next.id };
        rememberRightPaneSession(thread.id, session);
        return session;
      }
      const tabs = prev.tabs.map((t) => {
        if (t.id === next.id) return next;
        if (t.id === prev.activeId && isSchemaPane(t) && !prev.tabs.some((x) => x.id === next.id)) {
          return next;
        }
        return t;
      });
      const session = { tabs, activeId: next.id };
      rememberRightPaneSession(thread.id, session);
      return session;
    });
  }

  function defaultFilesTab(): FilesPaneContent {
    return {
      kind: 'files',
      id: 'files-brightsy-default',
      title: 'Files',
      datasource: 'brightsy',
      path: 'public',
      source: 'tool',
    };
  }

  function requestFilesTab(opts: {
    returnTabId: string;
    picker?: FilePickerRequest | null;
  }) {
    setRightSession((prev) => {
      const tabs = prev?.tabs ?? [];
      const filesTabs = tabs.filter(isFilesPane);
      let filesTab = filesTabs[0];
      let nextTabs = tabs;
      if (!filesTab) {
        filesTab = defaultFilesTab();
        nextTabs = [...tabs, filesTab];
      } else if (opts.picker && prev?.activeId) {
        // Prefer the files tab the user already has focused, if any.
        const activeFiles = filesTabs.find((t) => t.id === prev.activeId);
        if (activeFiles) filesTab = activeFiles;
      }
      const session = { tabs: nextTabs, activeId: filesTab.id };
      rememberRightPaneSession(thread.id, session);
      if (opts.picker) {
        setFilePicker({
          request: opts.picker,
          returnTabId: opts.returnTabId,
        });
      } else {
        setFilePicker(null);
      }
      return session;
    });
    onShowChat?.();
  }

  // Restore per-chat pane before paint so sidebar-collapse sees the new chat's
  // pane (not the previous chat's) when switching threads.
  useLayoutEffect(() => {
    suppressArtifactAutoOpen.current = isRightPaneSuppressed(thread.id);
    setFilePicker(null);
    setArtifactWidth(readRightColumnWidth(thread.worktreePath, RIGHT_COLUMN_WIDTH_DEFAULT));
    const remembered = getRememberedRightPaneSession(thread.id);
    if (remembered !== undefined) {
      setRightSession(remembered);
      return;
    }
    if (suppressArtifactAutoOpen.current) {
      setRightSession(null);
      return;
    }
    let fromHistory: RightPaneContent | null = null;
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i];
      if (m?.role !== 'agent') continue;
      fromHistory = latestRightPaneContent(m.text, m.parts, `msg-${i}`);
      if (fromHistory) break;
    }
    if (fromHistory) {
      const session = { tabs: [fromHistory], activeId: fromHistory.id };
      setRightSession(session);
      rememberRightPaneSession(thread.id, session);
    } else {
      setRightSession(null);
    }
  }, [thread.id]); // intentionally not thread.messages — avoid resetting form on each turn update

  function setPersistedArtifactWidth(width: number) {
    writeRightColumnWidth(thread.worktreePath, width);
  }
  // Auto-open while streaming; after the turn, migrate live → persisted ids.
  useEffect(() => {
    if (!chatViewOpen) return;

    if (showStreaming) {
      const candidate = latestRightPaneContent(liveOutput, liveParts, 'live');
      if (!candidate) return;
      if (suppressArtifactAutoOpen.current) {
        const closed = getClosedRightPane(thread.id);
        if (closed && sameRightPane(closed, candidate)) return;
        suppressArtifactAutoOpen.current = false;
        setRightPaneSuppressed(thread.id, false);
      }
      setRightSession((prev) => {
        const session = upsertTab(prev?.tabs ?? [], candidate);
        rememberRightPaneSession(thread.id, session);
        return session;
      });
      return;
    }

    setRightSession((prev) => {
      if (!prev?.tabs.length) return prev;
      for (let i = thread.messages.length - 1; i >= 0; i--) {
        const m = thread.messages[i];
        if (m?.role !== 'agent') continue;
        const candidate = latestRightPaneContent(m.text, m.parts, `msg-${i}`);
        if (!candidate) return prev;
        const liveIdx = prev.tabs.findIndex(
          (t) =>
            t.id.startsWith('live') ||
            t.id.startsWith('schema-live') ||
            t.id.startsWith('files-live') ||
            sameRightPane(t, candidate),
        );
        if (liveIdx < 0) return prev;
        const wasActive = prev.tabs[liveIdx]?.id === prev.activeId;
        const session = upsertTab(prev.tabs, candidate);
        const next = {
          tabs: session.tabs,
          activeId: wasActive ? session.activeId : prev.activeId,
        };
        rememberRightPaneSession(thread.id, next);
        return next;
      }
      return prev;
    });
  }, [
    chatViewOpen,
    showStreaming,
    liveOutput,
    liveParts,
    thread.messages,
    thread.id,
  ]);

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
        onNewTab={(opts) => void newTab(opts)}
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
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!closeBusy) setCloseConfirm(null);
          }}
        >
          <div
            className={`modal create-modal merge-modal${closeBusy ? ' is-creating' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-chat-title"
            aria-busy={closeBusy}
            onClick={(e) => e.stopPropagation()}
          >
            {closeBusy ? (
              <CreateProcessingOverlay
                mode="archive"
                repoName={closeConfirm.title.trim() || 'Untitled'}
                selectionHint={
                  closeConfirm.chatCount <= 1 && !isGlobalThread(thread)
                    ? 'removing worktree'
                    : `${closeConfirm.chatCount} chats`
                }
              />
            ) : null}
            <div className={`create-modal-content${closeBusy ? ' veiled' : ''}`}>
              <h3 id="close-chat-title" className="merge-modal-title">
                Close chat tab?
              </h3>
              <p className="confirm-dialog-message">
                {closeChatTabMessage(closeConfirm.title, closeConfirm.chatCount, {
                  removesWorktree: !isGlobalThread(thread),
                })}
              </p>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button
                  type="button"
                  disabled={closeBusy}
                  onClick={() => {
                    if (!closeBusy) setCloseConfirm(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={closeBusy}
                  onClick={() => {
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
                >
                  {closeBusy ? 'Closing…' : 'Close tab'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {forkWorkspaceConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!forkWorkspaceBusy) setForkWorkspaceConfirm(null);
          }}
        >
          <div
            className={`modal create-modal merge-modal${forkWorkspaceBusy ? ' is-creating' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fork-workspace-title"
            aria-busy={forkWorkspaceBusy}
            onClick={(e) => e.stopPropagation()}
          >
            {forkWorkspaceBusy ? (
              <CreateProcessingOverlay
                mode="create"
                repoName={
                  thread.repoPath.split('/').filter(Boolean).pop() ||
                  thread.title.trim() ||
                  'Workspace'
                }
                selectionHint="Fork to new workspace"
              />
            ) : null}
            <div className={`create-modal-content${forkWorkspaceBusy ? ' veiled' : ''}`}>
              <h3 id="fork-workspace-title" className="merge-modal-title">
                Fork to new workspace?
              </h3>
              <p className="confirm-dialog-message">
                Creates a new git worktree from{' '}
                <code>{thread.branchName || 'this branch'}</code> and opens it with
                the chat history through this message attached as a transcript.
              </p>
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 0 }}>
                <button
                  type="button"
                  disabled={forkWorkspaceBusy}
                  onClick={() => {
                    if (!forkWorkspaceBusy) setForkWorkspaceConfirm(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={forkWorkspaceBusy}
                  onClick={() => void confirmForkWorkspace()}
                >
                  {forkWorkspaceBusy ? 'Creating…' : 'Fork workspace'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`thread-workspace${rightPane && chatViewOpen ? ' with-artifact' : ''}`}
      >
        <div className="thread-chat-column">
      {changesOpen && changesPath ? (
        <FileEditor
          key={`changes:${changesPath}`}
          threadId={thread.id}
          path={changesPath}
          worktreePath={thread.worktreePath}
          initialView="diff"
          onClose={() => onCloseChanges?.()}
          onSaved={onRefresh}
          onDiffComment={(att) => {
            void appendAttachments([att]).then(() => {
              requestAnimationFrame(() => textareaRef.current?.focus());
            });
          }}
        />
      ) : openUrl ? (
        <UrlPreview
          key={openUrl}
          url={openUrl}
          suspended={urlPreviewSuspended}
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
          onDiffComment={(att) => {
            void appendAttachments([att]).then(() => {
              requestAnimationFrame(() => textareaRef.current?.focus());
            });
          }}
        />
      ) : (
        <div className="chat" ref={chatRef}>
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
                    onOpenThread={onOpenThreadLink}
                    onOpenArtifact={openRightPane}
                    activeArtifactId={rightPane?.id}
                    artifactIdPrefix={`msg-${i}`}
                    onFork={() => void forkToTab(i)}
                    onForkWorkspace={
                      canForkWorkspace
                        ? () => requestForkWorkspace(i)
                        : undefined
                    }
                  />
                ) : m.role === 'summary' ? (
                  <div className="msg-summary">
                    <div className="msg-summary-label">Context summarized</div>
                    <MarkdownMessage
                      text={m.text}
                      onThreadLinkClick={onOpenThreadLink}
                    />
                  </div>
                ) : (
                  <div className="msg-user-body">
                    {(m.attachments?.length ?? 0) > 0 && (
                      <ComposerAttachmentChips
                        attachments={m.attachments!}
                        className="msg-attachments"
                        expandImages
                        onOpen={onSelectFile}
                      />
                    )}
                    {m.text ? <div className="msg-body">{m.text}</div> : null}
                  </div>
                )}
              </div>
            );
          })}
          {pendingUser &&
            !turnInFlight &&
            !thread.messages.some((m) => m.role === 'user' && m.text === pendingUser) && (
              <div className="msg user pending">
                <div className="msg-user-body">
                  {pendingAttachments.length > 0 && (
                    <ComposerAttachmentChips
                      attachments={pendingAttachments}
                      className="msg-attachments"
                      expandImages
                      onOpen={onSelectFile}
                    />
                  )}
                  <div className="msg-body">{pendingUser}</div>
                </div>
              </div>
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
                    onOpenThread={onOpenThreadLink}
                    onOpenArtifact={openRightPane}
                    activeArtifactId={rightPane?.id}
                    artifactIdPrefix="live"
                    onFork={() =>
                      void forkToTab(Math.max(0, thread.messages.length - 1))
                    }
                    onForkWorkspace={
                      canForkWorkspace
                        ? () =>
                            requestForkWorkspace(
                              Math.max(0, thread.messages.length - 1),
                            )
                        : undefined
                    }
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
          {thread.lastError && !isRedundantLastError(thread) && (
            <div className="msg error" style={{ color: 'var(--err)' }}>
              {thread.lastError}
            </div>
          )}
        </div>
      )}

      {(thread.queue.length > 0 || pendingOptimistic) && (
        <div className="queued-messages" aria-label="Queued messages">
          <div className="queued-messages-label">Queued</div>
          <div className="queued-messages-list">
            {thread.queue.map((text, i) => (
              <div
                key={`queued-${i}`}
                className={`queued-msg${editingQueueIndex === i ? ' editing' : ''}`}
              >
                {editingQueueIndex === i ? (
                  <div className="queued-msg-edit">
                    <textarea
                      autoFocus
                      rows={Math.min(6, Math.max(2, text.split('\n').length))}
                      value={queueEditText}
                      onChange={(e) => setQueueEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void saveEditQueued(i);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEditQueued();
                        }
                      }}
                    />
                    <div className="queued-msg-edit-actions">
                      <button type="button" onClick={cancelEditQueued}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={queueBusyIndex === i || !queueEditText.trim()}
                        onClick={() => void saveEditQueued(i)}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="queued-msg-text">{text}</div>
                    <div className="queued-msg-actions">
                      <button
                        type="button"
                        className="queued-msg-icon-btn"
                        title="Send now — interrupts the current response"
                        aria-label="Send now"
                        disabled={queueBusyIndex === i}
                        onClick={() => void sendQueuedNow(i)}
                      >
                        <QueuedSendNowIcon />
                      </button>
                      <button
                        type="button"
                        className="queued-msg-icon-btn"
                        title="Edit"
                        aria-label="Edit"
                        disabled={queueBusyIndex === i}
                        onClick={() => startEditQueued(i, text)}
                      >
                        <QueuedEditIcon />
                      </button>
                      <button
                        type="button"
                        className="queued-msg-icon-btn danger"
                        title="Remove"
                        aria-label="Remove"
                        disabled={queueBusyIndex === i}
                        onClick={() => void removeQueued(i)}
                      >
                        <QueuedRemoveIcon />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {pendingOptimistic && (
              <div className="queued-msg pending">
                <div className="queued-msg-text">{pendingOptimistic}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={`composer-shell${openFilePath || changesOpen ? ' overlay' : ''}${composerExpanded ? ' expanded' : ' collapsed'}`}
      >
        <div
          ref={composerBoxRef}
          className={`composer-box${composerExpanded ? ' expanded' : ' collapsed'}${
            composerDragOver ? ' drag-over' : ''
          }`}
          onClick={() => {
            if (!composerExpanded) textareaRef.current?.focus();
          }}
          onDragEnter={(e) => {
            if (!preventComposerFileDrag(e)) return;
            setComposerDragOver(true);
          }}
          onDragLeave={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && e.currentTarget.contains(next)) return;
            setComposerDragOver(false);
          }}
          onDragOver={(e) => {
            if (!canAcceptComposerFileDrop(e.dataTransfer)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            if (!composerDragOver) setComposerDragOver(true);
          }}
          onDrop={(e) => {
            if (!preventComposerFileDrag(e)) return;
            setComposerDragOver(false);
            // Snapshot before DataTransfer is cleared after this handler returns.
            const snap = snapshotComposerDrop(e.dataTransfer);
            void attachDroppedSnapshot(snap);
          }}
        >
          {thread.planMode && !openFilePath && !openUrl && !changesOpen && (
            <div className="composer-plan-banner">
              Plan mode stays on until you turn it off or click Implement.
            </div>
          )}
          <ComposerAttachmentChips
            attachments={attachments}
            onRemove={(id) => void removeAttachment(id)}
            onOpen={onSelectFile}
            expandImages={false}
          />
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
              onPaste={(e) => {
                const buf = largePasteBufferFromEvent(e, attachments);
                if (!buf) return;
                void (async () => {
                  try {
                    const files = await window.sideboard.attachComposerFiles(thread.id, {
                      buffers: [buf],
                    });
                    await appendAttachments(files);
                  } catch (err) {
                    window.alert(err instanceof Error ? err.message : String(err));
                  }
                })();
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
                // Prevent textarea blur so toolbar toggles don't collapse the composer.
                e.preventDefault();
              }}
            >
              <div className="composer-left">
                <button
                  type="button"
                  className="chip active"
                  title="Choose model / agent"
                  onClick={() => {
                    setPlusOpen(false);
                    setAgentPickerOpen(true);
                  }}
                >
                  ▦ {modelLabel}
                </button>
                <ThinkingEffortChip
                  effort={displayEffort}
                  onChange={(effort) => toggleComposerOption({ effort })}
                />
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
                    setAgentPickerOpen(false);
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
        </div>

        {rightSession && rightSession.tabs.length > 0 && chatViewOpen ? (
          <RightColumnPane
            tabs={rightSession.tabs}
            activeId={rightSession.activeId}
            width={artifactWidth}
            onWidthChange={setArtifactWidth}
            onWidthChangeEnd={setPersistedArtifactWidth}
            onActivate={activateRightTab}
            onCloseTab={closeRightTab}
            onSchemaContentChange={updateSchemaTab}
            worktreeThreadId={thread.id}
            filePicker={filePicker}
            onFilePickerChange={setFilePicker}
            onRequestFilesTab={requestFilesTab}
          />
        ) : null}
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
      <AgentOptionsPicker
        open={agentPickerOpen}
        value={{
          agent: thread.agent,
          model: thread.model,
          autonomy: thread.autonomy,
          effort: displayEffort,
        }}
        allowedAgents={
          isOrchestratorThread(thread) ? ORCHESTRATOR_AGENT_KINDS : undefined
        }
        onClose={() => setAgentPickerOpen(false)}
        onApply={(next) => {
          void applyAgentOptions(next);
          if (next.agent === 'brightsy' && next.model) {
            void window.sideboard
              .listBrightsyChatTargets()
              .then(setBrightsyTargets)
              .catch(() => {});
          }
        }}
      />
    </section>
  );
}
