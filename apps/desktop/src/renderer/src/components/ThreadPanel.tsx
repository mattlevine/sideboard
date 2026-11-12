import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AgentKind,
  DiffScope,
  MessagePart,
  ThinkingEffort,
  Thread,
  ThreadAttachment,
  TokenUsage,
  WorktreeOpener,
  WorktreeOpenerId,
} from '@sideboard-ai/core';
import { resolveUsageOnLimit } from '@sideboard/usage-on-limit';
import { latestPendingPlanQuestions } from '@sideboard/plan-ask-user';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import { decodeBrightsyTarget, type BrightsyChatTargets } from '@sideboard/brightsy-targets';
import {
  RIGHT_COLUMN_WIDTH_DEFAULT,
  RightColumnPane,
  type RightColumnFilePicker,
} from './schema/RightColumnPane';
import type { FilePickerRequest } from './schema/FileManagerColumn';
import {
  applyShownPanes,
  finalizeRightPaneAfterStream,
  findLiveTabReplaceIndex,
  isFilesPane,
  isSchemaPane,
  latestRightPaneContent,
  panesForSession,
  sameRightPane,
  showPlanOpenSignature,
  showPlanPanes,
  upsertRightPaneTab,
  type FilesPaneContent,
  type RightPaneContent,
  type RightPaneSession,
  type SchemaPaneContent,
} from '../lib/right-pane';
import {
  getClosedRightPane,
  getRememberedRightPaneSession,
  isRightPaneSuppressed,
  rememberClosedRightPane,
  rememberRightPaneSession,
  setRightPaneSuppressed,
} from '../lib/right-pane-memory';
import { forwardOccupancyTokens, threadHasCompactedContext } from '@sideboard/context-estimate';
import {
  contextMeterTooltip,
  occupancyFillRatio,
  resolveContextWindow,
  sumUsage,
  tabsContextLabel,
  totalTokens,
} from '../lib/tokens';
import { useShowCost } from '../lib/show-cost';
import { useFollowUpBehavior } from '../lib/follow-up-behavior';
import { createUsageSendGate } from '../lib/usage-send-gate';
import { useLiveThread } from '../lib/live-paint-context';
import { usePhoneOpenArtifact } from '../lib/phone-open-file';
import { shouldShowClaudePlanUsage, useClaudePlanUsage } from '../lib/use-claude-usage';
import { ChatTabs } from './ChatTabs';
import { AccountSwitcher } from './AccountSwitcher';
import { ClaudeUsageMeter } from './ClaudeUsageMeter';
import { ConfirmDialog } from './ConfirmDialog';
import { DictationPermissionDialog } from './DictationPermissionDialog';
import {
  claudeUsageOverLimitWindows,
  formatClaudeUsageOverLimitConfirm,
  formatClaudeUsageOverLimitWait,
} from '@sideboard/claude-usage';
import { isRoutineStopNote, isSetupLastError } from '../lib/pane-progress';
import { CreateProcessingOverlay } from './CreateProcessingOverlay';
import { AgentOptionsPicker, type AgentOptionsValue } from './AgentOptionsPicker';
import { ThinkingEffortChip } from './ThinkingEffortChip';
import { PlanQuestionsPanel } from './PlanQuestionsPanel';
import { ToolPermissionBar, toolPermissionFromThread } from './ToolPermissionBar';
import { PlanApprovalCard } from './PlanApprovalCard';
import { PlanReadyBar } from './PlanReadyBar';
import {
  isPlanAwaitingApproval,
  latestPlanText,
  latestPresentedPlan,
} from '../lib/plan-ready';
import { PLAN_FILE_REL } from '@sideboard/plan-file';
import {
  agentModelLabel,
  cursorModelLabel,
  useAgentModels,
  useCursorModels,
} from './CursorModelMenu';
import {
  applyAutocomplete,
  autocompleteItemsFromQuery,
  ComposerAutocomplete,
  consumeAutocompleteKeyDown,
  getAutocompleteQuery,
  type AutocompleteItem,
} from './ComposerAutocomplete';
import { LinkIssuePicker, LinkWorkspacePicker } from './ComposerLinkPickers';
import { ComposerAttachmentChips } from './ComposerOptionsToolbar';
import { DictationMicButton } from './DictationMicButton';
import { FileEditor } from './FileEditor';
import { FloatingMenu } from './FloatingMenu';
import { ChatSearchBar } from './ChatSearchBar';
import { ChatTranscript, type ChatTranscriptHandlers } from './ChatTranscript';
import {
  copyWorktreePathKbd,
  FALLBACK_WORKTREE_OPENERS,
  installedWorktreeOpeners,
  matchWorktreeOpenShortcut,
  pickTriggerOpener,
  readLastWorktreeOpener,
  writeLastWorktreeOpener,
} from '../lib/worktree-opener';
import { PrPage } from './PrPage';
import { UrlPreview } from './UrlPreview';
import { prTabTitle } from '../lib/pr-activity';
import {
  canAcceptComposerFileDrop,
  composerDropSourcesFromSnapshot,
  preventComposerFileDrag,
  snapshotComposerDrop,
} from '../lib/composer-file-drop';
import {
  applyChatSearchHighlightRanges,
  clearChatSearchHighlights,
  collectChatSearchRanges,
  nextChatSearchIndex,
  scrollChatToElement,
  seedChatSearchQuery,
  shouldDeferChatFind,
  shouldRevealCompactedArchive,
  EMPTY_THREAD_MESSAGES,
} from '../lib/chat-search';
import { largePasteBufferFromEvent } from '../lib/paste-attachment';
import { isGlobalThread, isOrchestratorThread } from '../lib/global-workspace';
import { workspaceChromeLabels } from '../lib/workspace-chrome';
import {
  firstOpenRightColumnWidth,
  hasStoredRightColumnWidth,
  readRightColumnWidth,
  writeRightColumnWidth,
} from '../lib/panel-widths';
import {
  dropRemovedFollowUp,
  extraPendingFollowUps,
  joinsClaimedBefore,
  pendingSnapshotChanged,
  pendingTranscriptTexts,
  shouldDropStalePendingUser,
  shouldShowStreamingTurn,
  splitTurnQueue,
  unlandedFollowUps,
  unlandedUserTexts,
  type OptimisticUserSend,
  type PendingFollowUp,
} from '../lib/visible-follow-up-queue';
import { runComposerSend, submitPlanAnswer } from '../lib/composer-send';
import { visibleComposerAttachments } from '../lib/composer-attachments';
import { getComposerDraft, rememberComposerDraft } from '../lib/composer-draft';
import { useSpeechDictation } from '../lib/use-speech-dictation';
import { ChatJumpBottomButton, useChatStickToBottom } from './ChatJumpBottom';

/** Hide lastError when the last agent bubble already shows the same limit/auth failure. */
function isRedundantLastError(thread: Thread): boolean {
  const err = thread.lastError?.trim();
  if (!err) return false;
  if (isRoutineStopNote(err)) return true;
  // Setup / reconcile can stamp lastError mid-stream; the agent is still working
  // (or waiting for a concurrency slot after a batch create).
  if (thread.status === 'running' || thread.status === 'queued') return true;
  // Auto setup after create belongs in the Setup panel, not a red empty tab.
  if (isSetupLastError(err) && thread.messages.length === 0) return true;
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
  onRefresh: () => void;
  onSelectChat: (id: string, created?: Thread) => void;
  /** When the active chat is archived and no sibling tabs remain (e.g. last orchestration). */
  onLeaveThread?: () => void;
  /**
   * Archive a chat tab. Parent shows non-blocking pane progress when the
   * worktree is torn down (last tab).
   */
  onArchiveThread?: (
    threadId: string,
    meta?: { title?: string; removesWorktree?: boolean },
  ) => void | Promise<void>;
  composerPrefill?: string;
  onComposerPrefillConsumed?: () => void;
  findChatCmd?: { nonce: number; query: string } | null;
  onFindChatConsumed?: () => void;
  openFilePath?: string | null;
  openFileReveal?: { startLine?: number; endLine?: number } | null;
  openFiles?: string[];
  openFileView?: 'edit' | 'diff';
  openUrls?: string[];
  openUrl?: string | null;
  /** Dedicated Changes center tab (file list selection, not a basename tab). */
  changesOpen?: boolean;
  changesPath?: string | null;
  changesDiffScope?: DiffScope;
  changesCommitSha?: string | null;
  changesDiffBase?: string | null;
  onSelectFile?: (
    path: string,
    opts?: {
      view?: 'edit' | 'diff';
      scope?: DiffScope;
      commitSha?: string | null;
      base?: string | null;
      startLine?: number;
      endLine?: number;
    },
  ) => void;
  /** Focus a directory in the right-sidebar file tree. */
  onRevealDirectory?: (path: string) => void;
  onCloseFile?: (path: string) => void;
  onSelectUrl?: (url: string) => void;
  onCloseUrl?: (url: string) => void;
  onNavigateUrl?: (from: string, to: string) => void;
  onSelectChanges?: () => void;
  onCloseChanges?: () => void;
  /** Native PR page (GitHub API conversation / description). */
  prPageOpen?: boolean;
  onSelectPrPage?: () => void;
  onClosePrPage?: () => void;
  onShowChat?: () => void;
  /** Open another thread from a sideboard://chat/<id> markdown link. */
  onOpenThreadLink?: (threadRef: string) => void;
  /** Hide embedded BrowserView while a modal covers the app (e.g. Settings). */
  urlPreviewSuspended?: boolean;
  /** Git markers for open file tabs (from getDiff). */
  fileChanges?: Record<string, { status: string; additions?: number; deletions?: number }>;
  leftSidebarToggle?: ReactNode;
  rightSidebarToggle?: ReactNode;
  /** Rendered under the tab strip (orchestrator child-thread chips). */
  belowTabs?: ReactNode;
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

export function ThreadPanel({
  thread,
  worktreeChats,
  onRefresh,
  onSelectChat,
  onLeaveThread,
  composerPrefill,
  onComposerPrefillConsumed,
  findChatCmd,
  onFindChatConsumed,
  openFilePath = null,
  openFileReveal = null,
  openFiles = [],
  openFileView = 'edit',
  openUrls = [],
  openUrl = null,
  changesOpen = false,
  changesPath = null,
  changesDiffScope = 'uncommitted',
  changesCommitSha = null,
  changesDiffBase = null,
  onSelectFile,
  onRevealDirectory,
  onCloseFile,
  onSelectUrl,
  onCloseUrl,
  onNavigateUrl,
  onSelectChanges,
  onCloseChanges,
  prPageOpen = false,
  onSelectPrPage,
  onClosePrPage,
  onShowChat,
  onOpenThreadLink,
  urlPreviewSuspended = false,
  fileChanges = {},
  leftSidebarToggle,
  rightSidebarToggle,
  belowTabs,
}: Props) {
  const live = useLiveThread(thread.id);
  const liveOutput = live.output;
  const liveParts = live.parts;
  const liveUsage = live.usage ?? null;
  const turnStartedAt = live.startedAt;
  const showCost = useShowCost();
  const followUpBehavior = useFollowUpBehavior();
  const [prompt, setPrompt] = useState(() => getComposerDraft(thread.id));
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const dictation = useSpeechDictation({
    getValue: () => promptRef.current,
    setValue: setPrompt,
    resetKey: thread.id,
  });
  useEffect(() => {
    rememberComposerDraft(thread.id, prompt);
  }, [thread.id, prompt]);
  const [busy, setBusy] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [pendingInTranscript, setPendingInTranscript] = useState(false);
  const [optimisticUsers, setOptimisticUsers] = useState<OptimisticUserSend[]>([]);
  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUp[]>([]);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [queueEditText, setQueueEditText] = useState('');
  const [queueBusyIndex, setQueueBusyIndex] = useState<number | null>(null);
  const [usageLimitConfirm, setUsageLimitConfirm] = useState<{
    mode: 'confirm' | 'wait';
    message: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const sendGateRef = useRef(createUsageSendGate());
  const sendGate = sendGateRef.current;
  const pendingSendsRef = useRef<string[]>([]);
  /** Steer prompt still waiting for an agent reply. Follow-ups join this text. */
  const openPromptRef = useRef<string | null>(null);
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
  const [worktreeOpeners, setWorktreeOpeners] = useState<WorktreeOpener[]>(() =>
    installedWorktreeOpeners(FALLBACK_WORKTREE_OPENERS),
  );
  const [lastWorktreeOpener, setLastWorktreeOpener] = useState<WorktreeOpenerId>(() =>
    readLastWorktreeOpener(),
  );
  const [issuePickerOpen, setIssuePickerOpen] = useState(false);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const lastScrolledSearchKey = useRef<string | null>(null);
  const lastFindNonce = useRef<number | null>(null);
  /** Optimistic effort so the chip updates before refresh lands. */
  const [optimisticEffort, setOptimisticEffort] = useState<ThinkingEffort | null>(null);
  /** Optimistic Fast so the Cursor chip updates before refresh lands. */
  const [optimisticFast, setOptimisticFast] = useState<boolean | null>(null);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [skills, setSkills] = useState<
    Array<{ id: string; name: string; command: string; description: string; source: string }>
  >([]);
  const [acIndex, setAcIndex] = useState(0);
  const [acSuppressed, setAcSuppressed] = useState(false);
  const [cursor, setCursor] = useState(0);
  /** User dismissed the plan question panel for this tool id (show normal composer). */
  const [dismissedPlanQuestionsId, setDismissedPlanQuestionsId] = useState<string | null>(
    null,
  );
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
  const workspaceRef = useRef<HTMLDivElement>(null);
  const prevRightTabCount = useRef(0);
  const [filePicker, setFilePicker] = useState<RightColumnFilePicker | null>(null);
  /** After the user closes the pane, skip auto-open until a different artifact. */
  const suppressArtifactAutoOpen = useRef(isRightPaneSuppressed(thread.id));
  /** Last show_plan result already opened, so a refresh does not restore a closed tab. */
  const showPlanSigRef = useRef('');

  const rightPane =
    rightSession?.tabs.find((t) => t.id === rightSession.activeId) ??
    rightSession?.tabs[0] ??
    null;
  const chatViewOpen = !openFilePath && !openUrl && !changesOpen && !prPageOpen;
  const { chatRef, stickToBottomRef, awayFromBottom, scrollChatToLatest, scrollChatBy } =
    useChatStickToBottom({
      threadId: thread.id,
      chatViewOpen,
      messages: thread.messages,
      queue: thread.queue,
      liveOutput,
      liveParts,
      pendingUser,
    });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const acRef = useRef<HTMLDivElement>(null);
  const composerBoxRef = useRef<HTMLDivElement>(null);
  const queuedDockRef = useRef<HTMLDivElement>(null);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const openBtnRef = useRef<HTMLButtonElement>(null);

  const pendingPlanQuestions = useMemo(
    () =>
      latestPendingPlanQuestions({
        messages: thread.messages,
        liveParts,
        userReplied: Boolean(pendingUser),
        agentBlock: thread.agentBlock,
        dismissedQuestionSignature: thread.dismissedQuestionSignature,
        status: thread.status,
      }),
    [
      liveParts,
      thread.messages,
      pendingUser,
      thread.agentBlock,
      thread.dismissedQuestionSignature,
      thread.status,
    ],
  );

  const showPlanQuestions =
    Boolean(pendingPlanQuestions) &&
    pendingPlanQuestions!.signature !== dismissedPlanQuestionsId &&
    pendingPlanQuestions!.signature !== thread.dismissedQuestionSignature;
  const toolPermission = toolPermissionFromThread(thread);

  const planAwaitingApproval = useMemo(
    () =>
      isPlanAwaitingApproval({
        planMode: thread.planMode,
        status: thread.status,
        messages: thread.messages,
        liveParts,
        hasPendingQuestions: showPlanQuestions,
      }),
    [
      thread.planMode,
      thread.status,
      thread.messages,
      liveParts,
      showPlanQuestions,
    ],
  );

  const [planFileContent, setPlanFileContent] = useState<string | null>(null);

  useEffect(() => {
    const wantsFile =
      planAwaitingApproval ||
      liveParts.some((p) => p.type === 'tool' && /present_plan$/i.test(p.name ?? ''));
    if (!wantsFile || !thread.worktreePath?.trim()) {
      if (!planAwaitingApproval) setPlanFileContent(null);
      return;
    }
    let cancelled = false;
    void window.sideboard
      .readFile(thread.id, PLAN_FILE_REL)
      .then((f) => {
        if (cancelled) return;
        setPlanFileContent(f.binary ? null : f.content || null);
      })
      .catch(() => {
        if (!cancelled) setPlanFileContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    planAwaitingApproval,
    thread.id,
    thread.worktreePath,
    thread.messages.length,
    liveParts,
  ]);

  const composerExpanded =
    composerFocused ||
    showPlanQuestions ||
    planAwaitingApproval ||
    Boolean(prompt.trim()) ||
    plusOpen ||
    agentPickerOpen ||
    issuePickerOpen ||
    workspacePickerOpen ||
    (thread.attachments?.length ?? 0) > 0;

  const acQuery = useMemo(() => getAutocompleteQuery(prompt, cursor), [prompt, cursor]);
  const acItems: AutocompleteItem[] = useMemo(
    () =>
      autocompleteItemsFromQuery(acQuery, {
        suppressed: acSuppressed,
        filePaths,
        skills,
      }),
    [acQuery, acSuppressed, filePaths, skills],
  );

  useEffect(() => {
    setAcIndex(0);
    setAcSuppressed(false);
  }, [acQuery?.kind, acQuery?.query]);

  useEffect(() => {
    setOptimisticEffort(null);
  }, [thread.id, thread.effort]);

  useEffect(() => {
    setOptimisticFast(null);
  }, [thread.id, thread.fast]);

  const displayEffort: ThinkingEffort = optimisticEffort ?? thread.effort ?? 'high';
  const displayFast = optimisticFast ?? thread.fast;

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
    // Agent turns bump updatedAt constantly — don't walk the worktree on every token.
  }, [thread.id]);

  useEffect(() => {
    if (composerPrefill) {
      const next = composerPrefill.trimStart();
      if (next.trim()) {
        setPrompt((prev) => {
          const existing = prev.trimEnd();
          return existing ? `${existing}\n${next}` : next;
        });
      }
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

  const agentActive = thread.status === 'running' || thread.status === 'queued';
  const wasAgentActiveRef = useRef(agentActive);
  useEffect(() => {
    const wasActive = wasAgentActiveRef.current;
    wasAgentActiveRef.current = agentActive;
    if (!wasActive || agentActive) return;
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
      .catch(() => undefined);
    // Only this chat's composer (ThreadPanel is mounted for the open thread).
    // Don't steal the caret from another field or a background window.
    if (!document.hasFocus()) {
      return () => {
        cancelled = true;
      };
    }
    const active = document.activeElement;
    if (
      active &&
      active !== document.body &&
      active !== textareaRef.current &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable))
    ) {
      return () => {
        cancelled = true;
      };
    }
    setComposerFocused(true);
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [agentActive, thread.id]);

  useEffect(() => {
    explicitAskSkip.current = null;
    setDismissedPlanQuestionsId(null);
    setPendingUser(null);
    setPendingInTranscript(false);
    setOptimisticUsers([]);
    openPromptRef.current = null;
    setPendingFollowUps([]);
    setPendingAttachments([]);
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setChatSearchIndex(0);
  }, [thread.id]);

  const pendingSnapshot = useRef<{
    text: string;
    messages: Thread['messages'];
    queue: string[];
    status: Thread['status'];
  } | null>(null);
  useEffect(() => {
    if (!pendingUser) {
      pendingSnapshot.current = null;
      return;
    }
    const seen = pendingSnapshot.current;
    const threadMoved =
      seen?.text === pendingUser &&
      pendingSnapshotChanged(seen, {
        messages: thread.messages,
        queue: thread.queue,
        status: thread.status,
      });
    let latestIndex = -1;
    for (let i = 0; i < optimisticUsers.length; i++) {
      if (optimisticUsers[i]?.text === pendingUser) latestIndex = i;
    }
    const latest = latestIndex >= 0 ? optimisticUsers[latestIndex] : undefined;
    if (
      shouldDropStalePendingUser({
        text: pendingUser,
        messages: thread.messages,
        queue: thread.queue,
        status: thread.status,
        threadMoved,
        seen: latest?.seen,
        seenJoins: latest?.seenJoins,
        joinsClaimed:
          latestIndex >= 0
            ? joinsClaimedBefore(optimisticUsers, latestIndex, thread.messages)
            : 0,
      })
    ) {
      pendingSnapshot.current = null;
      setPendingUser(null);
      setPendingInTranscript(false);
      setPendingAttachments([]);
      // A resend of the same text keeps its own optimistic row until that
      // copy is stored. Matching on text alone would drop it with this one.
      setOptimisticUsers((prev) => {
        const next = prev.filter((item, index) => {
          if (item.text !== pendingUser) return true;
          return !shouldDropStalePendingUser({
            text: item.text,
            messages: thread.messages,
            queue: thread.queue,
            status: thread.status,
            threadMoved,
            seen: item.seen,
            seenJoins: item.seenJoins,
            joinsClaimed: joinsClaimedBefore(prev, index, thread.messages),
          });
        });
        return next.length === prev.length ? prev : next;
      });
      return;
    }
    pendingSnapshot.current = {
      text: pendingUser,
      messages: thread.messages,
      queue: thread.queue,
      status: thread.status,
    };
    const queueIndex = thread.queue.indexOf(pendingUser);
    if (queueIndex < 0) return;
    const turnBusy =
      Boolean(liveOutput) ||
      liveParts.length > 0 ||
      thread.status === 'running' ||
      Boolean(turnStartedAt);
    const settled =
      thread.status === 'idle' ||
      thread.status === 'stopped' ||
      thread.status === 'error' ||
      thread.status === 'broken' ||
      thread.status === 'archived';
    const agentLive =
      thread.status === 'running' ||
      (!settled &&
        (Boolean(liveOutput) || liveParts.length > 0 || Boolean(turnStartedAt)));
    // After Stop, a queued addition belongs in the queue dock. Keeping
    // pendingInTranscript would pin that bubble under every later message.
    const isCurrentTurnPrompt =
      (pendingInTranscript && agentLive) ||
      (!turnBusy && thread.status === 'queued' && queueIndex === 0);
    if (!isCurrentTurnPrompt) {
      pendingSnapshot.current = null;
      setPendingUser(null);
      setPendingInTranscript(false);
      setPendingAttachments([]);
    }
  }, [
    thread.messages,
    thread.queue,
    thread.status,
    pendingUser,
    pendingInTranscript,
    liveOutput,
    liveParts,
    turnStartedAt,
    optimisticUsers,
  ]);

  const optimisticSnapshot = useRef(
    new Map<string, { messages: Thread['messages']; queue: string[]; status: Thread['status'] }>(),
  );
  useEffect(() => {
    if (optimisticUsers.length === 0) {
      optimisticSnapshot.current.clear();
      return;
    }
    const unlanded = new Set(unlandedUserTexts(optimisticUsers, thread.messages));
    const stillPending = optimisticUsers.filter((item, index) => {
      if (!unlanded.has(item)) return false;
      const key = `${item.seen}:${item.text}`;
      const seen = optimisticSnapshot.current.get(key);
      const threadMoved =
        seen != null &&
        pendingSnapshotChanged(seen, {
          messages: thread.messages,
          queue: thread.queue,
          status: thread.status,
        });
      return !shouldDropStalePendingUser({
        text: item.text,
        messages: thread.messages,
        queue: thread.queue,
        status: thread.status,
        threadMoved,
        seen: item.seen,
        seenJoins: item.seenJoins,
        joinsClaimed: joinsClaimedBefore(optimisticUsers, index, thread.messages),
      });
    });
    const nextSnap = new Map<
      string,
      { messages: Thread['messages']; queue: string[]; status: Thread['status'] }
    >();
    for (const item of stillPending) {
      nextSnap.set(`${item.seen}:${item.text}`, {
        messages: thread.messages,
        queue: thread.queue,
        status: thread.status,
      });
    }
    optimisticSnapshot.current = nextSnap;
    if (stillPending.length !== optimisticUsers.length) setOptimisticUsers(stillPending);
  }, [optimisticUsers, thread.messages, thread.queue, thread.status]);

  useEffect(() => {
    if (editingQueueIndex === null) return;
    if (editingQueueIndex >= thread.queue.length) {
      setEditingQueueIndex(null);
      setQueueEditText('');
    }
  }, [thread.queue, editingQueueIndex]);

  useEffect(() => {
    setPendingFollowUps((prev) => {
      if (prev.length === 0) return prev;
      const landed = unlandedFollowUps(prev, thread.queue, thread.messages);
      return landed.length === prev.length &&
        landed.every(
          (p, i) => p.id === prev[i]?.id && p.queued === prev[i]?.queued && p.seen === prev[i]?.seen,
        )
        ? prev
        : landed;
    });
  }, [thread.messages, thread.queue]);

  useEffect(() => {
    void window.sideboard
      .listWorktreeOpeners()
      .then((list) => setWorktreeOpeners(installedWorktreeOpeners(list)))
      .catch(() => {
        /* keep FALLBACK_WORKTREE_OPENERS */
      });
  }, []);

  function openWorktreeApp(id: WorktreeOpenerId) {
    writeLastWorktreeOpener(id);
    setLastWorktreeOpener(id);
    void window.sideboard.openWorktree(thread.id, id).catch((err: unknown) => {
      window.alert(err instanceof Error ? err.message : String(err));
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const shortcut = matchWorktreeOpenShortcut(
        e,
        worktreeOpeners,
        openMenu && !isGlobalThread(thread),
      );
      if (shortcut) {
        e.preventDefault();
        setOpenMenu(false);
        if (shortcut.type === 'copy') {
          void navigator.clipboard?.writeText(thread.worktreePath);
        } else {
          openWorktreeApp(shortcut.id);
        }
        return;
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
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key === 'Enter' &&
        planAwaitingApproval
      ) {
        e.preventDefault();
        void implementPlan();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [thread.id, thread.worktreePath, planAwaitingApproval, openMenu, worktreeOpeners]);

  function patchOptions(patch: Parameters<typeof window.sideboard.setThreadOptions>[1]) {
    void window.sideboard
      .setThreadOptions(thread.id, patch)
      .then(() => {
        onRefresh();
      })
      .catch((err) => {
        setOptimisticEffort(null);
        setOptimisticFast(null);
        window.alert(err instanceof Error ? err.message : String(err));
      });
  }

  /** Toggle a chip without collapsing the composer (blur would otherwise minimize it). */
  function toggleComposerOption(patch: Parameters<typeof window.sideboard.setThreadOptions>[1]) {
    setComposerFocused(true);
    if (patch.effort !== undefined) setOptimisticEffort(patch.effort);
    if (patch.fast !== undefined) setOptimisticFast(patch.fast);
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
      setOptimisticFast(next.fast);
      patchOptions({
        model: next.model,
        autonomy: next.autonomy,
        effort: next.effort,
        fast: next.fast,
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (!midChat) {
      setOptimisticEffort(next.effort);
      setOptimisticFast(next.fast);
      patchOptions({
        agent: next.agent,
        model: next.model,
        autonomy: next.autonomy,
        effort: next.effort,
        fast: next.fast,
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
        fast: next.fast,
      });
      onSelectChat(t.id, t);
      onRefresh();
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  // A pending send or a queued follow-up is not the agent thinking. An empty
  // row after Stop stays hidden, but live text and tool parts stay until the
  // stopped turn commits them.
  const showStreaming = shouldShowStreamingTurn({
    status: thread.status,
    liveOutput,
    livePartCount: liveParts.length,
    turnStartedAt,
  });

  const liveHasPresentPlan = liveParts.some(
    (p) => p.type === 'tool' && /present_plan$/i.test(p.name ?? ''),
  );

  const presentedPlan = useMemo(() => {
    if (liveHasPresentPlan || (showStreaming && liveParts.length)) {
      const live = latestPresentedPlan(
        [
          {
            role: 'agent',
            text: liveOutput,
            parts: liveParts,
            ts: new Date().toISOString(),
          },
        ],
        planFileContent,
      );
      if (live) return live;
    }
    return latestPresentedPlan(thread.messages, planFileContent);
  }, [
    liveHasPresentPlan,
    showStreaming,
    liveParts,
    liveOutput,
    thread.messages,
    planFileContent,
  ]);

  const showPlanCard =
    Boolean(presentedPlan?.content) &&
    (planAwaitingApproval || liveHasPresentPlan) &&
    !showPlanQuestions &&
    !openFilePath &&
    !openUrl &&
    !changesOpen &&
    !prPageOpen;

  const lastAgentMessageIndex = useMemo(() => {
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      if (thread.messages[i]!.role === 'agent') return i;
    }
    return -1;
  }, [thread.messages]);

  const fallbackDurations = useMemo(() => {
    const out: Array<number | undefined> = [];
    let lastUserTs: string | undefined;
    for (const m of thread.messages) {
      if (m.role === 'user') lastUserTs = m.ts;
      if (m.role === 'agent' && lastUserTs) {
        out.push(Math.max(0, new Date(m.ts).getTime() - new Date(lastUserTs).getTime()));
      } else {
        out.push(undefined);
      }
    }
    return out;
  }, [thread.messages]);

  const turnBusy =
    showStreaming || thread.status === 'running' || Boolean(turnStartedAt);

  const { currentTurnPrompt: currentTurnFromQueue, followUps: followUpQueue } =
    splitTurnQueue(thread.queue, thread.status, turnBusy);
  const queueIndexOffset = currentTurnFromQueue ? 1 : 0;

  const pendingNotLanded =
    pendingUser &&
    !thread.messages.some((m) => m.role === 'user' && m.text === pendingUser) &&
    !thread.queue.includes(pendingUser)
      ? pendingUser
      : null;

  // A fresh array here busts ChatTranscript's memo, so composer keystrokes
  // rebuild markdown (mermaid, highlight, images) on every character.
  const pendingTranscripts = useMemo(
    () =>
      pendingTranscriptTexts({
        optimistic: optimisticUsers,
        messages: thread.messages,
        currentTurnPrompt: currentTurnFromQueue,
        pendingUser,
        pendingInTranscript,
      }),
    [
      optimisticUsers,
      thread.messages,
      currentTurnFromQueue,
      pendingUser,
      pendingInTranscript,
    ],
  );
  const shownInTranscript = new Set(pendingTranscripts);

  /** Follow-up while a turn is in flight (or already queued behind one). */
  const pendingQueue =
    pendingNotLanded &&
    !pendingInTranscript &&
    (turnBusy || Boolean(currentTurnFromQueue) || followUpQueue.length > 0)
      ? pendingNotLanded
      : null;

  const pendingFollowUpsLive = unlandedFollowUps(
    pendingFollowUps,
    thread.queue,
    thread.messages,
  );
  const optimisticFollowUps = extraPendingFollowUps(
    [
      ...followUpQueue,
      ...(pendingQueue ? [pendingQueue] : []),
    ],
    pendingFollowUpsLive,
  );
  const showQueueDock =
    followUpQueue.some((text) => !shownInTranscript.has(text)) ||
    Boolean(pendingQueue && !shownInTranscript.has(pendingQueue)) ||
    optimisticFollowUps.some((item) => !shownInTranscript.has(item.text));

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

  const [pendingAttachments, setPendingAttachments] = useState<ThreadAttachment[]>(
    [],
  );

  const followUpBusy =
    turnBusy ||
    thread.queue.length > 0 ||
    followUpQueue.length > 0 ||
    pendingFollowUpsLive.length > 0 ||
    optimisticUsers.length > 0;
  /** Agent text, thinking, or a tool — not merely "turn started". */
  const agentReplying = Boolean(liveOutput.trim()) || liveParts.length > 0;
  if (agentReplying) openPromptRef.current = null;
  /** Steer skips the composer queue once the agent has actually replied. */
  const steeringFollowUp = followUpBehavior === 'steer' && followUpBusy && agentReplying;

  const explicitAskSkip = useRef<string | null>(null);
  function skipAskUser(signature: string) {
    explicitAskSkip.current = signature;
    setDismissedPlanQuestionsId(signature);
    void window.sideboard.dismissAskUser(thread.id, signature).then(() => onRefresh());
  }
  useEffect(() => {
    const skip = explicitAskSkip.current;
    const saved = thread.dismissedQuestionSignature;
    if (skip && saved && skip === saved) explicitAskSkip.current = `seen:${saved}`;
    if (explicitAskSkip.current?.startsWith('seen:') && !saved) {
      explicitAskSkip.current = null;
      setDismissedPlanQuestionsId(null);
      return;
    }
    if (explicitAskSkip.current || saved) return;
    if (pendingUser || pendingFollowUpsLive.length > 0 || thread.queue.length > 0) return;
    setDismissedPlanQuestionsId((cur) => (cur == null ? cur : null));
  }, [pendingFollowUpsLive.length, pendingUser, thread.dismissedQuestionSignature, thread.queue.length]);

  function clearPendingSend() {
    setPendingUser(null);
    setPendingInTranscript(false);
    setPendingAttachments([]);
  }

  async function confirmSendDespiteClaudeUsage(): Promise<boolean> {
    return sendGate.shareConfirm(async () => {
      if (!thread) return true;
      try {
        const settings = await window.sideboard.getAppSettings();
        const action = resolveUsageOnLimit(settings.advanced);
        if (action === 'keep_going' || action === 'switch_agent') return true;
        const usage = await window.sideboard.getClaudeUsage(true);
        const over = claudeUsageOverLimitWindows(usage);
        if (over.length === 0) return true;
        if (action === 'wait_reset') {
          const message = formatClaudeUsageOverLimitWait(over);
          return await new Promise<boolean>((resolve) => {
            setUsageLimitConfirm({ mode: 'wait', message, resolve });
          });
        }
        const message = formatClaudeUsageOverLimitConfirm(over);
        return await new Promise<boolean>((resolve) => {
          setUsageLimitConfirm({ mode: 'confirm', message, resolve });
        });
      } catch {
        return true;
      }
    });
  }

  function composerSendInput() {
    return {
      dictationStop: () => dictation.stop(),
      promptRef,
      setPrompt,
      setCursor,
      followUpBehavior,
      agentReplying,
      openPromptRef,
      setOptimisticUsers,
      messages: thread.messages,
      setPendingUser,
      setPendingInTranscript,
      followUpBusy,
      busy,
      sendGate,
      pendingInTranscript,
      pendingUser,
      steeringFollowUp,
      confirmSendDespiteClaudeUsage,
      attachments: thread.attachments,
      threadId: thread.id,
      pendingPlanQuestions,
      setDismissedPlanQuestionsId,
      setPendingAttachments,
      setPendingFollowUps,
      suppressArtifactAutoOpen,
      setBusy,
      onRefresh,
      clearPendingSend,
      pendingSendsRef,
    };
  }

  async function send() {
    await runComposerSend(composerSendInput());
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
    const removedText = thread.queue[index];
    try {
      await window.sideboard.removeQueuedMessage(thread.id, index);
      if (removedText) {
        setPendingFollowUps((prev) => dropRemovedFollowUp(prev, removedText));
      }
      onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusyIndex(null);
    }
  }

  function sendQueuedNow(index: number) {
    const text = thread.queue[index];
    if (!text) return;
    // Promote reorders the queue — drop any open edit so we don't save against the wrong item.
    cancelEditQueued();
    setPendingUser(text);
    setPendingInTranscript(true);
    void window.sideboard.sendQueuedMessageNow(thread.id, index).catch((err) => {
      setPendingUser(null);
      setPendingInTranscript(false);
      window.alert(err instanceof Error ? err.message : String(err));
    });
  }

  /** First press must count: pointerdown + preventDefault so composer blur
   *  cannot shift the dock before mouseup. Keyboard still uses click (detail 0). */
  function queueActionPointer(disabled: boolean, run: () => void) {
    return {
      onPointerDown: (e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        run();
      },
      onClick: (e) => {
        if (disabled || e.detail > 0) return;
        run();
      },
    };
  }

  async function implementPlan() {
    if (busy) return;
    if (!sendGate.tryBegin()) return;
    try {
      if (!(await confirmSendDespiteClaudeUsage())) return;
      const notes = prompt.trim();
      await window.sideboard.setThreadOptions(thread.id, { planMode: false });
      setBusy(true);
      const text = notes
        ? `Implement the plan in ${PLAN_FILE_REL}.\n\nNotes:\n${notes}`
        : `Implement the plan in ${PLAN_FILE_REL}.`;
      setPendingUser(text);
      setPendingInTranscript(
        steeringFollowUp || (!turnBusy && thread.queue.length === 0),
      );
      setPrompt('');
      try {
        await window.sideboard.sendToThread(thread.id, text);
        onRefresh();
      } catch (err) {
        setPendingUser(null);
        setPendingInTranscript(false);
        window.alert(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    } finally {
      sendGate.end();
    }
  }

  async function copyPlan() {
    const text = latestPlanText(thread.messages, planFileContent);
    if (!text) {
      window.alert('No plan text to copy yet.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  /** Fork a new same-worktree chat with the plan history, then implement there. */
  async function handOffPlan() {
    if (busy) return;
    if (!sendGate.tryBegin()) return;
    try {
      if (!(await confirmSendDespiteClaudeUsage())) return;
      const notes = prompt.trim();
      setBusy(true);
      try {
        const throughIndex = Math.max(0, thread.messages.length - 1);
        const t = await window.sideboard.forkChatTab({
          threadId: thread.id,
          throughIndex,
        });
        await window.sideboard.setThreadOptions(t.id, { planMode: false });
        const text = notes
          ? `Implement the plan in ${PLAN_FILE_REL}.\n\nNotes:\n${notes}`
          : `Implement the plan in ${PLAN_FILE_REL}.`;
        setPrompt('');
        await window.sideboard.sendToThread(t.id, text);
        onSelectChat(t.id, t);
        onRefresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    } finally {
      sendGate.end();
    }
  }

  async function newTab(opts?: {
    agent?: AgentKind;
    model?: string | null;
    autonomy?: Thread['autonomy'];
    effort?: ThinkingEffort;
    fast?: boolean;
  }) {
    const t = await window.sideboard.createChatTab({
      fromThreadId: thread.id,
      agent: opts?.agent,
      model: opts?.model,
      autonomy: opts?.autonomy,
      effort: opts?.effort,
      fast: opts?.fast,
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

  function attachToChat(att: ThreadAttachment) {
    void appendAttachments([att]).then(() => {
      requestAnimationFrame(() => textareaRef.current?.focus());
    });
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
  const attachments = visibleComposerAttachments(thread.attachments ?? [], {
    pending: pendingAttachments,
    messages: thread.messages,
  });

  const threadUsage = useMemo(() => {
    const fromMessages = sumUsage(thread.messages.map((m) => m.usage));
    // Live turn is not persisted yet — fold it into the tab Σ while streaming.
    if (!liveUsage) return fromMessages;
    return sumUsage([fromMessages ?? undefined, liveUsage]);
  }, [thread.messages, liveUsage]);
  const latestContextUsage = useMemo(() => {
    if (liveUsage) return liveUsage;
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i];
      if (m?.role === 'agent' && m.usage) return m.usage;
    }
    return null;
  }, [thread.messages, liveUsage]);
  const forwardMessages = useMemo(() => {
    if (!liveOutput && liveParts.length === 0 && !liveUsage) return thread.messages;
    return [
      ...thread.messages,
      {
        role: 'agent' as const,
        text: liveOutput,
        parts: liveParts,
        ts: new Date().toISOString(),
      },
    ];
  }, [thread.messages, liveOutput, liveParts, liveUsage]);
  const contextWindow = resolveContextWindow(thread.agent, thread.model);
  // Cursor's usage blob is the turn's billed sum, not the window after summarization.
  const trustProviderOccupancy = thread.agent !== 'cursor';
  const forwardOccupancy = useMemo(
    () =>
      forwardOccupancyTokens(forwardMessages, latestContextUsage, contextWindow, {
        trustProviderOccupancy,
      }),
    [forwardMessages, latestContextUsage, contextWindow, trustProviderOccupancy],
  );
  const contextRatio = occupancyFillRatio(forwardOccupancy, contextWindow);
  const contextCompacted = threadHasCompactedContext(forwardMessages);
  const measuredWindow =
    trustProviderOccupancy &&
    (latestContextUsage?.lastRequestTokens ?? 0) > 0 &&
    (latestContextUsage?.lastRequestTokens ?? 0) <= contextWindow;
  const occupancyEstimated = !contextCompacted && !measuredWindow;
  const showClaudePlan = shouldShowClaudePlanUsage(thread);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const claudePlanUsage = useClaudePlanUsage(
    showClaudePlan,
    `${thread.status}:${thread.messages.length}:${accountEpoch}`,
  );

  const [chatSearchHitCount, setChatSearchHitCount] = useState(0);

  function openChatSearch(seed?: string) {
    const next = seedChatSearchQuery(seed, window.getSelection()?.toString() ?? '');
    setChatSearchOpen(true);
    if (next !== chatSearchQuery) {
      setChatSearchQuery(next);
      setChatSearchIndex(0);
      lastScrolledSearchKey.current = null;
    }
  }

  function stepChatSearch(delta: 1 | -1) {
    setChatSearchIndex((i) => nextChatSearchIndex(i, chatSearchHitCount, delta));
  }

  useEffect(() => {
    if (chatSearchHitCount > 0 && chatSearchIndex >= chatSearchHitCount) {
      setChatSearchIndex(chatSearchHitCount - 1);
    }
  }, [chatSearchHitCount, chatSearchIndex]);

  useLayoutEffect(() => {
    const root = chatRef.current;
    if (!root || !chatViewOpen) {
      clearChatSearchHighlights(root);
      return;
    }
    if (!chatSearchOpen) {
      clearChatSearchHighlights(root);
      setChatSearchHitCount(0);
      return;
    }
    const ranges = collectChatSearchRanges(root, chatSearchQuery);
    if (ranges.length !== chatSearchHitCount) setChatSearchHitCount(ranges.length);
    const currentEl = applyChatSearchHighlightRanges(root, ranges, chatSearchIndex);
    if (currentEl) {
      const token = `${chatSearchQuery}:${chatSearchIndex}:${ranges.length}`;
      if (lastScrolledSearchKey.current !== token) {
        lastScrolledSearchKey.current = token;
        stickToBottomRef.current = false;
        scrollChatToElement(root, currentEl);
      }
    }
    return () => clearChatSearchHighlights(root);
  }, [
    chatSearchOpen,
    chatSearchHitCount,
    chatSearchIndex,
    chatSearchQuery,
    chatViewOpen,
    liveOutput,
    pendingTranscripts.join('\n'),
    showStreaming,
    thread.messages,
    thread.compactedMessages,
  ]);

  useEffect(() => {
    if (!findChatCmd || lastFindNonce.current === findChatCmd.nonce) return;
    lastFindNonce.current = findChatCmd.nonce;
    openChatSearch(findChatCmd.query);
    onFindChatConsumed?.();
  }, [findChatCmd, onFindChatConsumed]);

  useEffect(() => {
    const onFindKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'f') {
        if (shouldDeferChatFind(e.target)) return;
        e.preventDefault();
        openChatSearch();
        return;
      }
      if (!chatSearchOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setChatSearchOpen(false);
        return;
      }
      if ((meta && e.key.toLowerCase() === 'g') || e.key === 'F3') {
        e.preventDefault();
        stepChatSearch(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onFindKey);
    return () => window.removeEventListener('keydown', onFindKey);
  }, [chatSearchOpen, chatSearchHitCount, chatSearchQuery]);

  function openRightPane(next: RightPaneContent) {
    suppressArtifactAutoOpen.current = false;
    setRightPaneSuppressed(thread.id, false);
    setRightSession((prev) => {
      const session = upsertRightPaneTab(prev?.tabs ?? [], next);
      rememberRightPaneSession(thread.id, session);
      return session;
    });
    onShowChat?.();
  }
  usePhoneOpenArtifact(thread, liveOutput, liveParts, openRightPane);

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

  function applyFirstOpenSplit() {
    if (hasStoredRightColumnWidth(thread.worktreePath)) {
      setArtifactWidth(
        readRightColumnWidth(thread.worktreePath, RIGHT_COLUMN_WIDTH_DEFAULT),
      );
      return;
    }
    setArtifactWidth(
      firstOpenRightColumnWidth(workspaceRef.current?.clientWidth ?? 0),
    );
  }

  // Restore per-chat pane before paint so sidebar-collapse sees the new chat's
  // pane (not the previous chat's) when switching threads.
  useLayoutEffect(() => {
    suppressArtifactAutoOpen.current = isRightPaneSuppressed(thread.id);
    setFilePicker(null);
    let seenPlan = '';
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const sig = showPlanOpenSignature(thread.messages[i]?.parts);
      if (sig) {
        seenPlan = sig;
        break;
      }
    }
    showPlanSigRef.current = seenPlan;
    const stored = getRememberedRightPaneSession(thread.id);
    const remembered = stored;
    if (remembered !== undefined) {
      const nextCount = remembered?.tabs.length ?? 0;
      prevRightTabCount.current = nextCount;
      if (nextCount > 0) applyFirstOpenSplit();
      setRightSession(remembered);
      return;
    }
    if (suppressArtifactAutoOpen.current) {
      prevRightTabCount.current = 0;
      setRightSession(null);
      return;
    }
    let opening: RightPaneContent[] = [];
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i];
      if (m?.role !== 'agent') continue;
      const planPanes = showPlanPanes(m.parts);
      const latest = latestRightPaneContent(m.text, m.parts, `msg-${i}`);
      const settled = latest ? finalizeRightPaneAfterStream(latest, m.parts) : null;
      opening = panesForSession(planPanes, settled);
      if (opening.length) break;
    }
    if (opening.length) {
      let session: RightPaneSession | null = null;
      for (const pane of opening) {
        session = upsertRightPaneTab(session?.tabs ?? [], pane);
      }
      prevRightTabCount.current = session?.tabs.length ?? 0;
      if (session && session.tabs.length > 0) applyFirstOpenSplit();
      setRightSession(session);
      rememberRightPaneSession(thread.id, session);
    } else {
      prevRightTabCount.current = 0;
      setRightSession(null);
    }
  }, [thread.id]); // intentionally not thread.messages — avoid resetting form on each turn update

  useLayoutEffect(() => {
    const n = rightSession?.tabs.length ?? 0;
    const openedFirst = prevRightTabCount.current === 0 && n > 0;
    prevRightTabCount.current = n;
    if (openedFirst) applyFirstOpenSplit();
  }, [rightSession?.tabs.length, thread.worktreePath, thread.id]);

  function setPersistedArtifactWidth(width: number) {
    writeRightColumnWidth(thread.worktreePath, width);
  }
  // Auto-open while streaming; after the turn, migrate live → persisted ids.
  useEffect(() => {
    if (!chatViewOpen) return;

    if (showStreaming) {
      const planPanes = showPlanPanes(liveParts);
      const candidate = latestRightPaneContent(liveOutput, liveParts, 'live');
      const sig = showPlanOpenSignature(liveParts);
      const fresh = sig !== '' && sig !== showPlanSigRef.current;
      const focus = candidate ?? (fresh ? planPanes[planPanes.length - 1] : null);
      if (!focus && planPanes.length === 0) return;
      if (focus && suppressArtifactAutoOpen.current) {
        const closed = getClosedRightPane(thread.id);
        if (closed && sameRightPane(closed, focus)) return;
        suppressArtifactAutoOpen.current = false;
        setRightPaneSuppressed(thread.id, false);
      }
      if (fresh) showPlanSigRef.current = sig;
      setRightSession((prev) => {
        let next = applyShownPanes(prev, planPanes, fresh ? 'insert' : 'update');
        if (candidate) {
          next = upsertRightPaneTab(next?.tabs ?? [], candidate, {
            activate: false,
            activeId: next?.activeId,
          });
        }
        if (!next) return prev;
        rememberRightPaneSession(thread.id, next);
        return next;
      });
      return;
    }

    let freshOpening: RightPaneContent[] | null = null;
    let freshSig = '';
    if (!suppressArtifactAutoOpen.current) {
      for (let i = thread.messages.length - 1; i >= 0; i--) {
        const m = thread.messages[i];
        if (m?.role !== 'agent') continue;
        const sig = showPlanOpenSignature(m.parts);
        if (sig && sig !== showPlanSigRef.current) {
          const planPanes = showPlanPanes(m.parts);
          const latest = latestRightPaneContent(m.text, m.parts, `msg-${i}`);
          const settled = latest ? finalizeRightPaneAfterStream(latest, m.parts) : null;
          freshOpening = panesForSession(planPanes, settled);
          freshSig = sig;
        }
        break;
      }
    }

    setRightSession((prev) => {
      let next = prev;
      if (freshOpening?.length) {
        const missing = freshOpening.some(
          (pane) => !next?.tabs.some((tab) => tab.id === pane.id || sameRightPane(tab, pane)),
        );
        if (missing || !next?.tabs.length) {
          showPlanSigRef.current = freshSig;
          next = applyShownPanes(next, freshOpening, 'insert');
        }
      }
      if (!next || next.tabs.length === 0) return next;
      for (let i = thread.messages.length - 1; i >= 0; i--) {
        const m = thread.messages[i];
        if (m?.role !== 'agent') continue;
        const candidate = latestRightPaneContent(m.text, m.parts, `msg-${i}`);
        if (!candidate) {
          if (next !== prev && next) rememberRightPaneSession(thread.id, next);
          return next;
        }
        const settled = finalizeRightPaneAfterStream(candidate, m.parts);
        const liveIdx = findLiveTabReplaceIndex(next.tabs, settled);
        if (liveIdx < 0) {
          if (next !== prev && next) rememberRightPaneSession(thread.id, next);
          return next;
        }
        const session = upsertRightPaneTab(next.tabs, settled, {
          activate: false,
          activeId: next.activeId,
          replaceId: next.tabs[liveIdx]!.id,
        });
        rememberRightPaneSession(thread.id, session);
        return session;
      }
      return next;
    });
  }, [
    chatViewOpen,
    showStreaming,
    liveOutput,
    liveParts,
    thread.messages,
    thread.id,
  ]);

  const chatHandlersRef = useRef<ChatTranscriptHandlers>({
    onSelectFile,
    onRevealDirectory,
    attachToChat,
    onOpenThreadLink,
    openRightPane,
    forkToTab,
    requestForkWorkspace,
  });
  chatHandlersRef.current = {
    onSelectFile,
    onRevealDirectory,
    attachToChat,
    onOpenThreadLink,
    openRightPane,
    forkToTab,
    requestForkWorkspace,
  };

  const chrome = workspaceChromeLabels(thread);
  const triggerOpener = pickTriggerOpener(worktreeOpeners, lastWorktreeOpener);
  const navigateOpenUrl = useCallback(
    (to: string) => {
      if (openUrl) onNavigateUrl?.(openUrl, to);
    },
    [onNavigateUrl, openUrl],
  );

  return (
    <section className="panel thread-main">
      <DictationPermissionDialog error={dictation.error} onDismiss={dictation.clearError} />
      {usageLimitConfirm ? (
        <ConfirmDialog
          title={
            usageLimitConfirm.mode === 'wait'
              ? 'Stopped until usage resets'
              : 'Claude usage is over the limit'
          }
          message={usageLimitConfirm.message}
          confirmLabel={usageLimitConfirm.mode === 'wait' ? 'OK' : 'Send anyway'}
          cancelLabel={usageLimitConfirm.mode === 'wait' ? 'Close' : 'Cancel'}
          onConfirm={() => {
            const resolve = usageLimitConfirm.resolve;
            const sendAnyway = usageLimitConfirm.mode === 'confirm';
            setUsageLimitConfirm(null);
            resolve(sendAnyway);
          }}
          onCancel={() => {
            const resolve = usageLimitConfirm.resolve;
            setUsageLimitConfirm(null);
            resolve(false);
          }}
        />
      ) : null}
      <ChatTabs
        chats={chats}
        activeChatId={thread.id}
        openFiles={openFiles}
        activeFilePath={openFilePath}
        openUrls={openUrls}
        activeUrl={openUrl}
        changesOpen={changesOpen}
        changesActive={changesOpen && !openFilePath && !openUrl && !prPageOpen}
        prPageOpen={prPageOpen}
        prPageActive={prPageOpen && !openFilePath && !openUrl && !changesOpen}
        prPageTitle={prTabTitle(thread)}
        onSelectPrPage={onSelectPrPage}
        onClosePrPage={onClosePrPage}
        changesCount={Object.keys(fileChanges).length}
        fileChanges={fileChanges}
        projectName={chrome.project}
        taskName={chrome.task}
        agentName={chrome.agent}
        onBack={onLeaveThread}
        leftSidebarToggle={leftSidebarToggle}
        rightSidebarToggle={rightSidebarToggle}
        statusBadge={
          thread.status === 'running' || thread.status === 'queued' ? thread.status : null
        }
        planUsage={
          <>
            <AccountSwitcher
              agent={thread.agent}
              onChanged={() => setAccountEpoch((n) => n + 1)}
            />
            <ClaudeUsageMeter
              usage={showClaudePlan ? claudePlanUsage : null}
              contextRatio={contextRatio}
              contextLabel={tabsContextLabel(
                forwardOccupancy,
                contextWindow,
                threadUsage?.costUsd,
                showCost,
              )}
              contextTooltip={contextMeterTooltip(latestContextUsage, contextWindow, {
                occupancy: forwardOccupancy,
                compacted: contextCompacted,
                estimated: occupancyEstimated,
                billedTotal: threadUsage ? totalTokens(threadUsage) : undefined,
              })}
            />
          </>
        }
        openMenu={
          isGlobalThread(thread) ? undefined : (
            <>
              <button
                ref={openBtnRef}
                type="button"
                className="chat-tab-open"
                title={
                  triggerOpener
                    ? `Open worktree in ${triggerOpener.label}`
                    : 'Open worktree'
                }
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setOpenMenu((v) => !v)}
              >
                {triggerOpener?.iconDataUrl ? (
                  <img
                    className="open-app-icon"
                    src={triggerOpener.iconDataUrl}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <span className="open-cube" aria-hidden />
                )}
                <span className="open-caret">▾</span>
              </button>
              <FloatingMenu
                open={openMenu}
                onClose={() => setOpenMenu(false)}
                anchorRef={openBtnRef}
                align="right"
                minWidth={220}
              >
                {worktreeOpeners.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      setOpenMenu(false);
                      openWorktreeApp(item.id);
                    }}
                  >
                    {item.iconDataUrl ? (
                      <img
                        className="open-app-icon"
                        src={item.iconDataUrl}
                        alt=""
                        draggable={false}
                      />
                    ) : (
                      <span className="open-app-icon open-app-icon-fallback" aria-hidden />
                    )}
                    <span>{item.label}</span>
                    <kbd>{String(i + 1)}</kbd>
                  </button>
                ))}
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setOpenMenu(false);
                    void navigator.clipboard?.writeText(thread.worktreePath);
                  }}
                >
                  <span className="open-app-icon" aria-hidden />
                  <span>Copy path</span>
                  <kbd>{copyWorktreePathKbd(worktreeOpeners)}</kbd>
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
        onFindChat={() => openChatSearch()}
      />
      {belowTabs}

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
        ref={workspaceRef}
        className={`thread-workspace${rightPane && chatViewOpen ? ' with-artifact' : ''}`}
      >
        <div className="thread-chat-column">
      {chatSearchOpen ? (
        <ChatSearchBar
          query={chatSearchQuery}
          current={chatSearchHitCount ? chatSearchIndex + 1 : 0}
          total={chatSearchHitCount}
          onQueryChange={(next) => {
            setChatSearchQuery(next);
            setChatSearchIndex(0);
            lastScrolledSearchKey.current = null;
          }}
          onNext={() => stepChatSearch(1)}
          onPrev={() => stepChatSearch(-1)}
          onClose={() => setChatSearchOpen(false)}
        />
      ) : null}
      {prPageOpen ? (
        <PrPage threadId={thread.id} onAddToChat={attachToChat} />
      ) : changesOpen && changesPath ? (
        <FileEditor
          key={`changes:${changesPath}:${changesDiffScope}:${changesCommitSha ?? ''}`}
          threadId={thread.id}
          path={changesPath}
          worktreePath={thread.worktreePath}
          initialView="diff"
          diffScope={changesDiffScope}
          commitSha={changesCommitSha}
          diffBase={changesDiffBase}
          onClose={() => onCloseChanges?.()}
          onSaved={onRefresh}
          onDiffComment={attachToChat}
          onCodeReference={attachToChat}
        />
      ) : openUrl ? (
        <UrlPreview
          key={openUrl}
          url={openUrl}
          suspended={urlPreviewSuspended}
          onNavigate={navigateOpenUrl}
          onClose={() => onCloseUrl?.(openUrl)}
        />
      ) : openFilePath ? (
        <FileEditor
          threadId={thread.id}
          path={openFilePath}
          worktreePath={thread.worktreePath}
          initialView={openFileView}
          revealLine={openFileReveal?.startLine}
          highlightEndLine={openFileReveal?.endLine}
          onClose={() => onCloseFile?.(openFilePath)}
          onSaved={onRefresh}
          onDiffComment={attachToChat}
          onCodeReference={attachToChat}
        />
      ) : (
        <div className="chat-scroll">
        <div className="chat" ref={chatRef}>
          {/* Setup stays in the Setup panel. The create spinner here cycled
              "Sending first message" for the whole install, and a send hid
              the empty state immediately — so a PR opened with no prompt
              looked stuck loading until you typed. */}
          {thread.messages.length === 0 &&
            !pendingUser &&
            pendingTranscripts.length === 0 &&
            !showStreaming &&
            !(thread.lastError && !isRedundantLastError(thread)) && (
              <div className="chat-empty">
                <div className="chat-empty-mark" aria-hidden>
                  <span className="chat-empty-cube" />
                </div>
                {thread.sourceType === 'orchestration' ||
                isGlobalThread(thread) ? (
                  <>
                    <h3>What should we orchestrate?</h3>
                    <p>
                      {isGlobalThread(thread)
                        ? 'Steer worktree agents across registered repos with Sideboard MCP. Slack DMs and @mentions land here.'
                        : 'Coordinate child worktree agents from this orchestration agent.'}{' '}
                      Use <kbd>⌘L</kbd> to focus the composer.
                    </p>
                  </>
                ) : thread.cowboy ? (
                  <>
                    <h3>What are you changing on main?</h3>
                    <p>
                      This chat edits the project folder on {thread.branchName} and
                      can push there. Archive does not delete the folder. Use{' '}
                      <kbd>⌘L</kbd> to focus the composer.
                    </p>
                  </>
                ) : (
                  <>
                    <h3>What are you working on?</h3>
                    <p>
                      Ask Sideboard to explore this worktree, make changes, or
                      summarize a PR. Use <kbd>⌘L</kbd> to focus the composer.
                    </p>
                  </>
                )}
              </div>
            )}
          <ChatTranscript
            messages={thread.messages}
            compactedMessages={thread.compactedMessages ?? EMPTY_THREAD_MESSAGES}
            forceRevealEarlier={
              chatSearchOpen &&
              shouldRevealCompactedArchive(
                chatSearchQuery,
                thread.compactedMessages ?? EMPTY_THREAD_MESSAGES,
              )
            }
            fallbackDurations={fallbackDurations}
            showPlanCard={showPlanCard}
            showStreaming={showStreaming}
            lastAgentMessageIndex={lastAgentMessageIndex}
            presentedPlanSource={presentedPlan?.source}
            showPlanQuestions={showPlanQuestions}
            pendingPlanQuestions={pendingPlanQuestions}
            pendingTranscripts={pendingTranscripts}
            pendingAttachments={pendingAttachments}
            liveOutput={liveOutput}
            liveParts={liveParts}
            liveUsage={liveUsage}
            turnStartedAt={turnStartedAt}
            forwardOccupancy={forwardOccupancy}
            occupancyEstimated={occupancyEstimated}
            threadId={thread.id}
            worktreePath={thread.worktreePath}
            agent={thread.agent}
            model={thread.model}
            status={thread.status}
            filePaths={filePaths}
            activeArtifactId={rightPane?.id}
            canForkWorkspace={canForkWorkspace}
            liveHasPresentPlan={liveHasPresentPlan}
            handlersRef={chatHandlersRef}
          />
          {showPlanCard && presentedPlan && (
            <div className="msg agent plan-at-end">
              <PlanApprovalCard
                title={presentedPlan.title}
                path={presentedPlan.path}
                content={presentedPlan.content}
                onOpenFile={onSelectFile}
              />
            </div>
          )}
          {thread.lastError && !isRedundantLastError(thread) && (
            <div className="msg error" style={{ color: 'var(--err)' }}>
              {thread.lastError}
            </div>
          )}
        </div>
        {awayFromBottom ? (
          <ChatJumpBottomButton onClick={scrollChatToLatest} onWheel={scrollChatBy} />
        ) : null}
        </div>
      )}

      <div
        className={`composer-shell${openFilePath || changesOpen || prPageOpen ? ' overlay' : ''}${composerExpanded ? ' expanded' : ' collapsed'}${
          showQueueDock ? ' has-queue' : ''
        }`}
      >
        {showQueueDock && (
          <div
            ref={queuedDockRef}
            className="queued-messages"
            aria-label="Queued messages"
          >
            <div className="queued-messages-label">Queued</div>
            <div className="queued-messages-list">
              {followUpQueue.map((text, i) => {
                const queueIndex = i + queueIndexOffset;
                if (shownInTranscript.has(text)) return null;
                return (
                <div
                  key={`queued-${queueIndex}`}
                  className={`queued-msg${editingQueueIndex === queueIndex ? ' editing' : ''}`}
                >
                  {editingQueueIndex === queueIndex ? (
                    <div className="queued-msg-edit">
                      <textarea
                        autoFocus
                        rows={Math.min(6, Math.max(2, text.split('\n').length))}
                        value={queueEditText}
                        onChange={(e) => setQueueEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void saveEditQueued(queueIndex);
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
                          disabled={
                            queueBusyIndex === queueIndex || !queueEditText.trim()
                          }
                          onClick={() => void saveEditQueued(queueIndex)}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="queued-msg-text">{text}</div>
                      <div
                        className="queued-msg-actions"
                        onPointerDown={(e) => {
                          // Composer collapse (blur) would shift this dock before
                          // mouseup, so the first click never reaches the button.
                          e.preventDefault();
                        }}
                      >
                        <button
                          type="button"
                          className="queued-msg-icon-btn"
                          title="Send now — interrupts the current response"
                          aria-label="Send now"
                          disabled={queueBusyIndex === queueIndex}
                          {...queueActionPointer(
                            queueBusyIndex === queueIndex,
                            () => {
                              void sendQueuedNow(queueIndex);
                            },
                          )}
                        >
                          <QueuedSendNowIcon />
                        </button>
                        <button
                          type="button"
                          className="queued-msg-icon-btn"
                          title="Edit"
                          aria-label="Edit"
                          disabled={queueBusyIndex === queueIndex}
                          {...queueActionPointer(
                            queueBusyIndex === queueIndex,
                            () => {
                              startEditQueued(queueIndex, text);
                            },
                          )}
                        >
                          <QueuedEditIcon />
                        </button>
                        <button
                          type="button"
                          className="queued-msg-icon-btn danger"
                          title="Remove"
                          aria-label="Remove"
                          disabled={queueBusyIndex === queueIndex}
                          {...queueActionPointer(
                            queueBusyIndex === queueIndex,
                            () => {
                              void removeQueued(queueIndex);
                            },
                          )}
                        >
                          <QueuedRemoveIcon />
                        </button>
                      </div>
                    </>
                  )}
                </div>
                );
              })}
              {pendingQueue && !shownInTranscript.has(pendingQueue) && (
                <div className="queued-msg pending">
                  {pendingAttachments.length > 0 && (
                    <ComposerAttachmentChips
                      attachments={pendingAttachments}
                      className="msg-attachments"
                      expandImages={false}
                      onOpen={onSelectFile}
                    />
                  )}
                  <div className="queued-msg-text">{pendingQueue}</div>
                </div>
              )}
              {optimisticFollowUps
                .filter((item) => !shownInTranscript.has(item.text))
                .map((item) => (
                <div key={item.id} className="queued-msg pending">
                  <div className="queued-msg-text">{item.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}
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
            setComposerFocused(true);
            requestAnimationFrame(() => {
              textareaRef.current?.focus({ preventScroll: true });
            });
            void attachDroppedSnapshot(snap);
          }}
        >
          <ComposerAttachmentChips
            attachments={attachments}
            onRemove={(id) => void removeAttachment(id)}
            onOpen={onSelectFile}
            expandImages={false}
          />
          {planAwaitingApproval && !showPlanQuestions && (
            <PlanReadyBar
              busy={busy}
              onCopy={() => void copyPlan()}
              onHandOff={() => void handOffPlan()}
              onApprove={() => void implementPlan()}
            />
          )}
          {toolPermission ? <ToolPermissionBar prompt={toolPermission} /> : null}
          {showPlanQuestions && pendingPlanQuestions ? (
            <PlanQuestionsPanel
              pending={pendingPlanQuestions}
              busy={busy}
              onDismiss={() => skipAskUser(pendingPlanQuestions.signature)}
              onSubmit={(message) => {
                void submitPlanAnswer(composerSendInput(), message);
              }}
            />
          ) : (
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
                  ? followUpBehavior === 'steer'
                    ? 'Steer — send now to add to the chat…'
                    : 'Queued when you send…'
                  : planAwaitingApproval
                    ? 'Optional notes for Approve / Hand off…'
                    : thread.planMode
                      ? 'Plan mode — agent will analyze and plan without editing files'
                      : thread.sourceType === 'orchestration' || isGlobalThread(thread)
                        ? 'Describe a goal — spawn and steer worktree agents via MCP'
                        : 'Ask to make changes, @mention files, run /commands'
              }
              onFocus={() => setComposerFocused(true)}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (composerBoxRef.current?.contains(next)) return;
                if (acRef.current?.contains(next)) return;
                if (queuedDockRef.current?.contains(next)) return;
                // Delay so toolbar / autocomplete / queue-dock clicks can run
                // first. setTimeout(0) is too short: collapse still shifts the
                // dock before mouseup in Chromium.
                window.setTimeout(() => {
                  const active = document.activeElement;
                  if (composerBoxRef.current?.contains(active)) return;
                  if (acRef.current?.contains(active)) return;
                  if (queuedDockRef.current?.contains(active)) return;
                  setComposerFocused(false);
                }, 150);
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
                if (
                  consumeAutocompleteKeyDown(e, {
                    items: acItems,
                    activeIndex: acIndex,
                    onIndex: setAcIndex,
                    onPick: pickAutocomplete,
                    onSuppress: () => setAcSuppressed(true),
                  })
                ) {
                  return;
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
            {!composerExpanded && (
              <DictationMicButton
                listening={dictation.listening}
                supported={dictation.supported}
                error={dictation.error}
                onStart={dictation.start}
                onStop={dictation.stop}
              />
            )}
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
                disabled={!prompt.trim()}
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
          )}
          {composerExpanded && !showPlanQuestions && (
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
                  <span className="chip-model-icon" aria-hidden>
                    ▦
                  </span>
                  <span className="chip-label">{modelLabel}</span>
                </button>
                <ThinkingEffortChip
                  effort={displayEffort}
                  onChange={(effort) => toggleComposerOption({ effort })}
                />
                {thread.agent === 'cursor' ? (
                  <button
                    type="button"
                    className={`chip${displayFast ? ' active fast' : ''}`}
                    title="Cursor Fast — ~2× usage for Grok and other models that support it. Off uses standard speed."
                    onClick={() => toggleComposerOption({ fast: !displayFast })}
                  >
                    <span className="chip-bolt" aria-hidden>
                      ⚡
                    </span>{' '}
                    <span className="chip-label">Fast</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`chip${thread.planMode ? ' active plan' : ''}`}
                  title="Plan mode — analyze and plan without editing files"
                  onClick={() => toggleComposerOption({ planMode: !thread.planMode })}
                >
                  <span className="chip-plan-icon" aria-hidden>
                    ◫
                  </span>
                  <span className="chip-label">Plan</span>
                </button>
              </div>
              <div className="composer-right">
                {thread.planMode &&
                  thread.messages.some((m) => m.role === 'agent') &&
                  !planAwaitingApproval && (
                  <button
                    type="button"
                    className="chip implement-plan"
                    title="Turn off Plan mode and ask the agent to implement"
                    disabled={busy}
                    onClick={() => void implementPlan()}
                  >
                    <span className="chip-implement-icon" aria-hidden>
                      ▶
                    </span>
                    <span className="chip-label">Implement</span>
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
                <DictationMicButton
                  listening={dictation.listening}
                  supported={dictation.supported}
                  error={dictation.error}
                  onStart={dictation.start}
                  onStop={dictation.stop}
                />
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
                  disabled={!prompt.trim()}
                  title={
                  agentActive
                    ? followUpBehavior === 'steer'
                      ? 'Steer — send now, skip the queue'
                      : 'Queue message'
                    : 'Send'
                }
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
          fast: displayFast,
        }}
        allowedAgents={
          isOrchestratorThread(thread) ? ORCHESTRATOR_AGENT_KINDS : undefined
        }
        onClose={() => setAgentPickerOpen(false)}
        onLiveChange={(next) => {
          // Effort / Fast only — never fork via agent switch from a chip toggle.
          setOptimisticEffort(next.effort);
          setOptimisticFast(next.fast);
          patchOptions({ effort: next.effort, fast: next.fast });
        }}
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
