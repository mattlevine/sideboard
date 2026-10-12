import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AudioRecorder } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import {
  ComposerDock,
  DEFAULT_OPTIONS,
  IssuePicker,
  type AgentId,
  type ComposerOptions,
  type CreateMode,
  type CreateSelection,
  type FileChip,
  type LinkChip,
  type PhoneSources,
} from './chat-ui';
import { loadDesktops, saveDesktops, type SavedDesktop } from './desktops';
import { pickDocuments, pickPhotos, startMic, stopMic, takePhoto, type PickedFile } from './media';
import { type FilePathLink } from './file-link';
import { phoneSendExtras, type PhoneCodeSelection } from './phone-code-ref';
import { PhoneCodeRefChips } from './phone-file-select';
import { imageCacheKey, publishImage } from './media-cache';
import { EmptyChat } from './empty-chat';
import { MarkdownText, streamVerb, type ArtifactLink } from './markdown';
import { usePhoneOpenDocs, artifactDocId, fileDocId } from './phone-open-docs';
import { viewerFromPhoneReply } from './phone-viewer';
import { PhoneWorkspace, usePhonePanes, type PhoneRightHeader } from './phone-tabs';
import { PhoneAgentsScreen, type PhoneProject } from './phone-agents';
import { createRelayLink, RELAY_UNREACHABLE, type RelayLink } from './relay-link';
import { AgentKindIcon } from './agent-icons';
import { SearchGlyph } from './sidebar-icons';
import {
  Brand,
  HistoryRow,
  type PhoneChat,
  type PhoneHistoryChat,
  phonePrBadge,
  StreamStatus,
} from './phone-chrome';
import { ChatFindBar, MessageTextTool } from './chat-find';
import { currentLocalIndex, findBubbleSearchHits, nextChatSearchIndex, seedChatSearchQuery } from './chat-search';
import {
  filterPhoneOrchestration,
  filterPhoneProjects,
  phoneOrchestrationVisible,
  phoneTagChoices,
  togglePhoneTagFilter,
} from './sidebar-filter';
import { palette, styles } from './styles';
import { useTransientError } from './transient-error';
import { composerOptionsFor, type PhoneAccountDefaults } from './account-defaults';
import { composerPlaceholder, desktopStatus, historyCount, onMac } from './labels';
import { applyStream, finishAgent, openedTranscript, pushBubble, settleBubbles } from './transcript';
import { paintedFindStrings } from './find-surface';

type AskOption = { label: string; description?: string };
type AskQuestion = { question: string; options: AskOption[] };
type Bubble = { id: string; role: 'user' | 'agent'; text: string; streaming?: boolean };
type Desktop = SavedDesktop & { online: boolean | null; expired: boolean };
type Transcript = {
  bubbles: Bubble[];
  questions: AskQuestion[] | null;
  working: boolean;
  activity?: string;
};
type Screen = 'loading' | 'desktops' | 'pair' | 'agents' | 'history' | 'chat';
type PhonePlace =
  | { kind: 'orchestration' }
  | { kind: 'project'; repoPath: string; worktree: string };
type PhoneControl =
  | { op: 'sidebar'; orchestration: PhoneChat[]; projects: PhoneProject[]; defaults?: PhoneAccountDefaults }
  | {
      op: 'history';
      chats: PhoneHistoryChat[];
      total?: number;
      next?: string;
      query?: string;
      after?: string;
    }
  | { op: 'restored'; chatId: string }
  | {
      op: 'opened';
      chat: PhoneChat;
      messages: Array<{ role: 'user' | 'agent'; text: string; streaming?: boolean }>;
      place?: PhonePlace;
      options?: ComposerOptions;
    }
  | { op: 'assistant'; chatId: string; text: string }
  | { op: 'stream'; chatId: string; text: string; activity?: string }
  | { op: 'ask'; chatId: string; text: string; questions: AskQuestion[] }
  | { op: 'stopped'; chatId: string }
  | { op: 'media'; chatId: string; path: string; dataUrl?: string }
  | { op: 'error'; message: string; chatId?: string }
  | ({ op: 'sources'; repoPath: string; query?: string } & PhoneSources)
  | { op: 'models'; agent: AgentId; models: Array<{ id: string; label: string }> }
  | { op: 'dictated'; id: string; text: string }
  | ({ op: 'options'; chatId: string } & ComposerOptions)
  | ({
      op: 'header';
      chatId: string;
      visible?: boolean;
      branch?: string;
      additions?: number;
      deletions?: number;
      unpushed?: number;
      dirty?: boolean;
      ready?: boolean;
      title?: string;
      prUrl?: string;
      prNumber?: string;
      prStatus?: string;
      action?: string;
      actionLabel?: string;
    });

const DEFAULT_URL = 'wss://relay.sideboard.cloud/remote';
/** Must match PHONE_CONTROL_PREFIX in packages/core. Rides inside prompt text. */
const PHONE_CONTROL_PREFIX = '\u0000sb.phone\n';

type ServerMessage =
  | { type: 'paired'; deviceId: string; deviceLabel: string; sessionToken: string }
  | { type: 'assistant'; text: string }
  | { type: 'ask_user'; text: string; questions: AskQuestion[] }
  | {
      type: 'hosts';
      hosts: Array<{ sessionToken: string; deviceId: string; deviceLabel: string; online: boolean }>;
    }
  | { type: 'host_offline' }
  | { type: 'error'; message: string }
  | { type: 'pong' };

const EMPTY: Transcript = { bubbles: [], questions: null, working: false };

function parseServer(raw: string): ServerMessage | null {
  try {
    const msg = JSON.parse(raw) as ServerMessage;
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return null;
    return msg;
  } catch {
    return null;
  }
}

function persist(desktops: Desktop[]) {
  void saveDesktops(
    desktops.map(({ deviceId, deviceLabel, sessionToken }) => ({ deviceId, deviceLabel, sessionToken })),
  );
}

function phoneCommand(payload: object) {
  return { type: 'prompt' as const, text: PHONE_CONTROL_PREFIX + JSON.stringify(payload) };
}

function decodePhoneReply(text: string): PhoneControl | null {
  if (!text.startsWith(PHONE_CONTROL_PREFIX)) return null;
  try {
    const value = JSON.parse(text.slice(PHONE_CONTROL_PREFIX.length)) as PhoneControl;
    if (!value || typeof value !== 'object' || typeof (value as { op?: unknown }).op !== 'string') return null;
    return value;
  } catch {
    return null;
  }
}

export default function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [code, setCode] = useState('');
  const [desktops, setDesktops] = useState<Desktop[]>([]);
  const [screen, setScreen] = useState<Screen>('loading');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [orchestration, setOrchestration] = useState<PhoneChat[]>([]);
  const [projects, setProjects] = useState<PhoneProject[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [history, setHistory] = useState<PhoneHistoryChat[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [textToolId, setTextToolId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({});
  const [draft, setDraft] = useState('');
  const [error, setTransientError] = useTransientError();
  const errorRef = useRef<string | null>(null);
  const setError = (message: string | null, sticky = false) => (errorRef.current = message, setTransientError(message, sticky));
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [files, setFiles] = useState<FileChip[]>([]);
  const [links, setLinks] = useState<LinkChip[]>([]);
  const [codeRefs, setCodeRefs] = useState<Array<PhoneCodeSelection & { id: string }>>([]);
  const [chatOptions, setChatOptions] = useState<Record<string, ComposerOptions>>({});
  const [createMode, setCreateMode] = useState<CreateMode | null>(null);
  const [createDraft, setCreateDraft] = useState('');
  const [createFiles, setCreateFiles] = useState<FileChip[]>([]);
  const [createLinks, setCreateLinks] = useState<LinkChip[]>([]);
  const [createOptions, setCreateOptions] = useState<ComposerOptions>(DEFAULT_OPTIONS);
  const [sources, setSources] = useState<PhoneSources | null>(null);
  const [modelsByAgent, setModelsByAgent] = useState<Partial<Record<AgentId, Array<{ id: string; label: string }>>>>({});
  const [listening, setListening] = useState(false);
  const [issuePickerFor, setIssuePickerFor] = useState<string | null>(null);
  const [rightHeader, setRightHeader] = useState<PhoneRightHeader | null | false>(null);
  const openDocs = usePhoneOpenDocs();

  const tagChoices = useMemo(() => phoneTagChoices(projects, tagFilters), [projects, tagFilters]);
  const visibleOrchestration = useMemo(
    () => filterPhoneOrchestration(orchestration, sidebarQuery),
    [orchestration, sidebarQuery],
  );
  const showOrchestration = useMemo(
    () => phoneOrchestrationVisible(orchestration, sidebarQuery),
    [orchestration, sidebarQuery],
  );
  const visibleProjects = useMemo(
    () => filterPhoneProjects(projects, sidebarQuery, tagFilters),
    [projects, sidebarQuery, tagFilters],
  );
  const sidebarFiltering = sidebarQuery.trim().length > 0 || tagFilters.length > 0;

  useEffect(() => {
    setFilterOpen(false);
    setSidebarQuery('');
    setTagFilters([]);
  }, [activeId]);

  function toggleSidebarTag(tag: string) {
    setTagFilters((current) => togglePhoneTagFilter(current, tag));
  }

  const desktopsRef = useRef(desktops);
  const activeIdRef = useRef(activeId);
  const activeChatIdRef = useRef(activeChatId);
  const lastPhoneOpRef = useRef<string | null>(null);
  const headerOkRef = useRef(true);
  const headerPendingRef = useRef(false);
  const pendingImageRef = useRef<string | null>(null);
  const requestedImagesRef = useRef(new Set<string>());
  const projectsRef = useRef(projects);
  const accountDefaultsRef = useRef<PhoneAccountDefaults | null>(null);
  const urlRef = useRef(url);
  const pendingTokenRef = useRef<string | null>(null);
  const screenRef = useRef(screen);
  const historyQueryRef = useRef('');
  const historyAfterRef = useRef<string | null>(null);
  const historyAppliedRef = useRef<string | null>(null);
  const historyNextRef = useRef<string | null>(null);
  const historyLoadingRef = useRef(false);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingRef = useRef<AudioRecorder | null>(null);
  const dictateApplyRef = useRef<(text: string) => void>(() => undefined);
  const dictateIdRef = useRef<string | null>(null);
  const sourceQueryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptScrollRef = useRef<ScrollView>(null);
  const pinTranscriptRef = useRef(true);
  const bubbleY = useRef<Record<string, number>>({});
  const selectionRef = useRef('');
  const attachedRef = useRef(false);
  const checkingHostsRef = useRef(false);
  const pendingSendRef = useRef<object | null>(null);
  const onMessageRef = useRef<(raw: string) => void>(() => undefined);
  const linkRef = useRef<RelayLink | null>(null);
  desktopsRef.current = desktops;
  activeIdRef.current = activeId;
  activeChatIdRef.current = activeChatId;
  projectsRef.current = projects;
  urlRef.current = url;
  screenRef.current = screen;
  if (!linkRef.current) {
    linkRef.current = createRelayLink({
      url: () => urlRef.current.trim() || DEFAULT_URL,
      onMessage: (raw) => onMessageRef.current(raw),
      onError: (message) => (checkingHostsRef.current = false, setError(message, message === RELAY_UNREACHABLE)),
      onOpen: () => (errorRef.current === RELAY_UNREACHABLE ? setError(null) : undefined),
      onClose: () => (attachedRef.current = false),
      onNeedsRetry: () => {
        const tokens = screenRef.current === 'desktops' ? desktopsRef.current.map((row) => row.sessionToken) : [];
        if (tokens.length === 0) return;
        checkingHostsRef.current = true;
        linkRef.current?.send({ type: 'list_hosts', sessionTokens: tokens });
      },
      hasHosts: () => screenRef.current === 'desktops' && desktopsRef.current.length > 0,
      attached: () => attachedRef.current,
      inChat: () => onMac(screenRef.current),
      sessionToken: () => {
        const id = activeIdRef.current;
        const desktop = id ? desktopsRef.current.find((row) => row.deviceId === id) : undefined;
        return desktop?.sessionToken ?? pendingTokenRef.current;
      },
    });
  }
  const link = linkRef.current;
  const panes = usePhonePanes((payload) => link.send(phoneCommand(payload)), () => activeChatIdRef.current);

  useEffect(() => {
    headerOkRef.current = true;
  }, [activeId]);

  useEffect(() => {
    setRightHeader(null);
    if (screen !== 'chat' || !activeChatId) return;
    let stopped = false;
    const tick = () => {
      if (stopped || !headerOkRef.current || !attachedRef.current) return;
      const busy = lastPhoneOpRef.current === 'open-file' || lastPhoneOpRef.current === 'media';
      if (busy) return;
      lastPhoneOpRef.current = 'header';
      headerPendingRef.current = true;
      link.send(phoneCommand({ op: 'header', chatId: activeChatId }));
    };
    tick();
    const timer = setInterval(tick, 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [screen, activeChatId, link]);

  function patchDesktop(sessionToken: string, patch: Partial<Desktop>) {
    setDesktops((prev) => {
      const next = prev.map((row) => (row.sessionToken === sessionToken ? { ...row, ...patch } : row));
      persist(next);
      return next;
    });
  }

  function remember(desktop: Desktop) {
    setDesktops((prev) => {
      const next = [
        ...prev.filter((row) => row.deviceId !== desktop.deviceId && row.sessionToken !== desktop.sessionToken),
        desktop,
      ];
      persist(next);
      return next;
    });
  }

  function mapChats(apply: (chat: PhoneChat) => PhoneChat) {
    setOrchestration((prev) => prev.map(apply));
    setProjects((prev) =>
      prev.map((project) => ({
        ...project,
        worktrees: project.worktrees.map((worktree) => ({
          ...worktree,
          chats: worktree.chats.map(apply),
        })),
      })),
    );
  }

  function patchChat(chatId: string, patch: Partial<PhoneChat>) {
    mapChats((row) => (row.id === chatId ? { ...row, ...patch } : row));
  }

  function rememberOpened(chat: PhoneChat, place?: PhonePlace) {
    if (place?.kind === 'project' && place.repoPath) {
      const label = place.worktree || 'Worktree';
      setProjects((prev) =>
        prev.map((project) => {
          if (project.path !== place.repoPath) return project;
          const worktree = project.worktrees.find((row) => row.label === label);
          if (!worktree) {
            return { ...project, worktrees: [...project.worktrees, { label, chats: [chat] }] };
          }
          return {
            ...project,
            worktrees: project.worktrees.map((row) =>
              row.label === label
                ? { ...row, chats: [...row.chats.filter((item) => item.id !== chat.id), chat] }
                : row,
            ),
          };
        }),
      );
      setOrchestration((prev) => prev.filter((row) => row.id !== chat.id));
      return;
    }
    const inProject = projectsRef.current.some((project) =>
      project.worktrees.some((worktree) => worktree.chats.some((row) => row.id === chat.id)),
    );
    if (inProject) {
      patchChat(chat.id, chat);
      return;
    }
    setOrchestration((prev) => [chat, ...prev.filter((row) => row.id !== chat.id)]);
  }

  function applyControl(control: PhoneControl) {
    if (control.op === 'sidebar') {
      const nextOrchestration = Array.isArray(control.orchestration)
        ? control.orchestration.filter((row) => row?.id && row.title)
        : [];
      const nextProjects = Array.isArray(control.projects)
        ? control.projects
            .filter((project) => project?.name && Array.isArray(project.worktrees))
            .map((project) => ({
              ...project,
              worktrees: project.worktrees.map((worktree) => ({
                ...worktree,
                badge: phonePrBadge(worktree?.badge),
              })),
            }))
        : [];
      setOrchestration(nextOrchestration);
      setProjects(nextProjects);
      if (control.defaults?.orchestration && control.defaults.worktree) {
        accountDefaultsRef.current = control.defaults;
      }
      const ids = new Set(nextOrchestration.map((row) => row.id));
      for (const project of nextProjects) {
        for (const worktree of project.worktrees ?? []) {
          for (const chat of worktree.chats ?? []) {
            if (chat?.id) ids.add(chat.id);
          }
        }
      }
      const id = activeChatIdRef.current;
      if (id && screenRef.current === 'chat' && !ids.has(id)) {
        setActiveChatId(null);
        screenRef.current = 'agents';
        setScreen('agents');
      }
      return;
    }
    if (control.op === 'history') {
      const query = control.query ?? '';
      const after = control.after ?? '';
      if (query !== historyQueryRef.current) return;
      if (after !== (historyAfterRef.current ?? '')) return;
      if (after !== '' && after === historyAppliedRef.current) return;
      historyAppliedRef.current = after;
      historyLoadingRef.current = false;
      setHistoryLoading(false);
      setPendingRestore(null);
      const chats = Array.isArray(control.chats)
        ? control.chats.filter((chat) => chat?.id && chat.title)
        : [];
      if (after) {
        setHistory((prev) => {
          const seen = new Set(prev.map((chat) => chat.id));
          return [...prev, ...chats.filter((chat) => !seen.has(chat.id))];
        });
      } else {
        setHistory(chats);
      }
      const next = control.next ?? null;
      historyNextRef.current = next;
      setHistoryTotal(typeof control.total === 'number' ? control.total : chats.length);
      return;
    }
    if (control.op === 'restored' && control.chatId) {
      const chatId = control.chatId;
      setPendingRestore(null);
      setHistory((prev) => prev.filter((chat) => chat.id !== chatId));
      setHistoryTotal((total) => Math.max(0, total - 1));
      return;
    }
    if (control.op === 'opened' && control.chat?.id) {
      const chat = { ...control.chat, agent: control.chat.agent || control.options?.agent };
      if (chat.id !== activeChatIdRef.current) {
        clearChatTools();
        openDocs.closeAll(); setCodeRefs([]);
      }
      setPendingAdd(null);
      setCreateMode(null);
      if (control.options) {
        setChatOptions((prev) => ({ ...prev, [chat.id]: control.options! }));
      }
      rememberOpened(chat, control.place);
      setActiveChatId(chat.id);
      panes.setPane('chat');
      screenRef.current = 'chat';
      setScreen('chat');
      setTranscripts((prev) => ({
        ...prev,
        [chat.id]: openedTranscript(chat.id, control.messages, chat.status),
      }));
      return;
    }
    if (control.op === 'stream' && control.chatId) {
      const chatId = control.chatId;
      const text = control.text ?? '';
      const activity = control.activity ?? '';
      setTranscripts((prev) => ({
        ...prev,
        [chatId]: applyStream(prev[chatId] ?? EMPTY, text, activity),
      }));
      patchChat(chatId, {
        status: 'running',
        ...(text.trim()
          ? { preview: text.replace(/\s+/g, ' ').trim().slice(0, 90) }
          : {}),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if ((control.op === 'assistant' || control.op === 'ask') && control.chatId) {
      const chatId = control.chatId;
      setTranscripts((prev) => {
        const current = prev[chatId] ?? EMPTY;
        return {
          ...prev,
          [chatId]: {
            bubbles: finishAgent(current.bubbles, control.text),
            questions: control.op === 'ask' ? control.questions : null,
            working: false,
            activity: '',
          },
        };
      });
      patchChat(chatId, {
        status: 'idle',
        preview: control.text.replace(/\s+/g, ' ').trim().slice(0, 90),
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (control.op === 'stopped' && control.chatId) {
      const chatId = control.chatId;
      setTranscripts((prev) => ({
        ...prev,
        [chatId]: {
          ...(prev[chatId] ?? EMPTY),
          bubbles: settleBubbles((prev[chatId] ?? EMPTY).bubbles),
          working: false,
          questions: null,
          activity: '',
        },
      }));
      patchChat(chatId, { status: 'stopped' });
      return;
    }
    if (control.op === 'sources' && control.repoPath) {
      setSources({
        prs: Array.isArray(control.prs) ? control.prs : [],
        branches: Array.isArray(control.branches) ? control.branches : [],
        issues: Array.isArray(control.issues) ? control.issues : [],
        ...(control.warnings?.length ? { warnings: control.warnings } : {}),
      });
      return;
    }
    if (control.op === 'models' && control.agent) {
      const agent = control.agent;
      setModelsByAgent((prev) => ({ ...prev, [agent]: Array.isArray(control.models) ? control.models : [] }));
      return;
    }
    if (control.op === 'dictated') {
      if (control.id && control.id === dictateIdRef.current) {
        const spoken = control.text.trim();
        if (spoken) dictateApplyRef.current(spoken);
        else setError('Didn’t catch that. Try again.');
      }
      dictateIdRef.current = null;
      setListening(false);
      return;
    }
    if (control.op === 'options' && control.chatId) {
      const chatId = control.chatId;
      setChatOptions((prev) => ({
        ...prev,
        [chatId]: {
          agent: control.agent,
          model: control.model ?? null,
          effort: control.effort,
          fast: Boolean(control.fast),
          planMode: Boolean(control.planMode),
          autonomy: control.autonomy === 'full' ? 'full' : 'default',
        },
      }));
      return;
    }
    if (control.op === 'media' && control.path) {
      const key = imageCacheKey(control.chatId ?? '', control.path);
      publishImage(key, control.dataUrl ?? null);
      if (pendingImageRef.current === key) pendingImageRef.current = null;
      return;
    }
    const decision = viewerFromPhoneReply(
      control,
      openDocs.current(),
      lastPhoneOpRef.current === 'open-file',
      activeChatIdRef.current,
    );
    if (decision.handled) {
      lastPhoneOpRef.current = null;
      if (decision.viewer) openDocs.apply(decision.viewer);
      return;
    }
    if (control.op === 'header') {
      headerPendingRef.current = false;
      if (control.chatId && control.chatId !== activeChatIdRef.current) return;
      if (!control.visible || !control.branch) {
        setRightHeader(false);
        return;
      }
      setRightHeader({
        branch: control.branch,
        additions: control.additions ?? 0,
        deletions: control.deletions ?? 0,
        unpushed: control.unpushed ?? 0,
        dirty: Boolean(control.dirty),
        ready: Boolean(control.ready),
        ...(control.title ? { title: control.title } : {}),
        ...(control.prUrl ? { prUrl: control.prUrl } : {}),
        ...(control.prNumber ? { prNumber: control.prNumber } : {}),
        ...(control.prStatus ? { prStatus: control.prStatus } : {}),
        ...(control.action ? { action: control.action } : {}),
        ...(control.actionLabel ? { actionLabel: control.actionLabel } : {}),
      });
      return;
    }
    if (panes.takeControl(control)) return;
    if (control.op === 'error') {
      const askedMac = lastPhoneOpRef.current === 'media';
      if (control.message === 'invalid phone command' && lastPhoneOpRef.current === 'header') {
        headerPendingRef.current = false;
        headerOkRef.current = false;
        lastPhoneOpRef.current = null;
        return;
      }
      if (control.message === 'invalid phone command' && askedMac) {
        if (pendingImageRef.current) publishImage(pendingImageRef.current, null);
        pendingImageRef.current = null;
        lastPhoneOpRef.current = null;
        return;
      }
      historyLoadingRef.current = false;
      setHistoryLoading(false);
      setPendingAdd(null);
      setPendingRestore(null);
      setError(control.message || 'Sideboard failed.');
      if (control.chatId) {
        const chatId = control.chatId;
        setTranscripts((prev) => ({
          ...prev,
          [chatId]: {
            ...(prev[chatId] ?? EMPTY),
            bubbles: settleBubbles((prev[chatId] ?? EMPTY).bubbles),
            working: false,
            activity: '',
          },
        }));
      }
    }
  }

  onMessageRef.current = (raw: string) => {
    const msg = parseServer(raw);
    if (!msg) return;
    if (msg.type === 'hosts') {
      checkingHostsRef.current = false;
      if (screenRef.current === 'desktops') setError(null);
      setDesktops((prev) => {
        const next = prev.map((row) => {
          const listed = msg.hosts.find((host) => host.sessionToken === row.sessionToken);
          if (!listed || !listed.deviceId) return { ...row, online: false, expired: true };
          return {
            ...row,
            deviceId: listed.deviceId,
            deviceLabel: listed.deviceLabel || row.deviceLabel,
            online: listed.online,
            expired: false,
          };
        });
        persist(next);
        return next;
      });
      return;
    }
    if (msg.type === 'paired') {
      const desktop: Desktop = {
        deviceId: msg.deviceId,
        deviceLabel: msg.deviceLabel,
        sessionToken: msg.sessionToken,
        online: true,
        expired: false,
      };
      remember(desktop);
      setActiveId(desktop.deviceId);
      pendingTokenRef.current = desktop.sessionToken;
      attachedRef.current = true;
      link.cancelResume();
      const pending = pendingSendRef.current;
      pendingSendRef.current = null;
      setError(null);
      if (pending) link.send(pending);
      if (screenRef.current === 'chat' && activeChatIdRef.current) {
        link.send(phoneCommand({ op: 'open', chatId: activeChatIdRef.current }));
        if (headerOkRef.current) {
          lastPhoneOpRef.current = 'header';
          headerPendingRef.current = true;
          link.send(phoneCommand({ op: 'header', chatId: activeChatIdRef.current }));
        }
      } else {
        screenRef.current = 'agents';
        setScreen('agents');
        link.send(phoneCommand({ op: 'list' }));
      }
      return;
    }
    if (msg.type === 'assistant' || msg.type === 'ask_user') {
      if (msg.type === 'assistant') {
        const control = decodePhoneReply(msg.text);
        if (control) {
          applyControl(control);
          return;
        }
      }
      const id = activeChatIdRef.current;
      if (!id) return;
      setTranscripts((prev) => {
        const current = prev[id] ?? EMPTY;
        return {
          ...prev,
          [id]: {
            bubbles: pushBubble(current.bubbles, 'agent', msg.text),
            questions: msg.type === 'ask_user' ? msg.questions : null,
            working: false,
          },
        };
      });
      return;
    }
    if (msg.type === 'pong') {
      link.notePong();
      return;
    }
    if (msg.type === 'host_offline') {
      attachedRef.current = false;
      if (screenRef.current === 'desktops' && checkingHostsRef.current) return;
      const token = pendingTokenRef.current;
      if (token) patchDesktop(token, { online: false });
      setError(
        onMac(screenRef.current)
          ? 'That Mac is offline. Reconnecting…'
          : 'That Mac is offline. Open Sideboard on it, then choose it again.',
      );
      const id = activeChatIdRef.current;
      if (id) {
        setTranscripts((prev) => ({
          ...prev,
          [id]: { ...(prev[id] ?? EMPTY), working: Boolean(pendingSendRef.current) },
        }));
      }
      link.scheduleResume();
      return;
    }
    if (msg.type === 'error') {
      const token = pendingTokenRef.current;
      if (token && /pair again/i.test(msg.message)) {
        patchDesktop(token, { online: false, expired: true });
        attachedRef.current = false;
        pendingSendRef.current = null;
        link.cancelResume();
      }
      setError(msg.message);
    }
  };

  function showDesktops() {
    link.cancelResume();
    setError(null);
    const tokens = desktopsRef.current.map((row) => row.sessionToken);
    if (tokens.length === 0) {
      screenRef.current = 'pair';
      setScreen('pair');
      return;
    }
    screenRef.current = 'desktops';
    setScreen('desktops');
    checkingHostsRef.current = true;
    link.send({ type: 'list_hosts', sessionTokens: tokens });
  }

  function choose(desktop: Desktop) {
    if (desktop.expired) {
      setError(`${desktop.deviceLabel} needs a new pairing code.`);
      setScreen('pair');
      return;
    }
    setError(null);
    pendingTokenRef.current = desktop.sessionToken;
    link.send({ type: 'resume', sessionToken: desktop.sessionToken });
  }

  function forget(deviceId: string) {
    const wasActive = activeIdRef.current === deviceId;
    const next = desktopsRef.current.filter((row) => row.deviceId !== deviceId);
    setDesktops(next);
    persist(next);
    if (wasActive) {
      setActiveId(null);
      link.cancelResume();
      screenRef.current = next.length === 0 ? 'pair' : 'desktops';
      setScreen(screenRef.current);
    } else if (next.length === 0) setScreen((screenRef.current = 'pair'));
  }

  function showAgents() {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    openDocs.closeAll();
    panes.setPane('chat');
    setError(null);
    screenRef.current = 'agents';
    setScreen('agents');
    if (attachedRef.current) link.send(phoneCommand({ op: 'list' }));
  }

  function sendHistory(query: string, after?: string) {
    historyQueryRef.current = query;
    historyAfterRef.current = after ?? null;
    if (!after) historyAppliedRef.current = null;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    if (attachedRef.current) {
      link.send(
        phoneCommand({
          op: 'history',
          ...(query ? { query } : {}),
          ...(after ? { after } : {}),
        }),
      );
    }
  }

  function loadMoreHistory() {
    const after = historyNextRef.current;
    if (!after || historyLoadingRef.current) return;
    sendHistory(historyQueryRef.current, after);
  }
  function openDesktopArtifact(artifact: ArtifactLink) {
    const id = activeChatIdRef.current;
    if (!id) return;
    lastPhoneOpRef.current = 'open-file';
    openDocs.showOpening(artifactDocId(artifact.title), artifact.title);
    panes.setPane('doc');
    link.send(phoneCommand({
      op: 'open-artifact',
      chatId: id,
      title: artifact.title,
      ...(artifact.hint ? { hint: artifact.hint } : {}),
    }));
  }

  function openDesktopFile(file: FilePathLink) {
    const id = activeChatIdRef.current;
    if (!id) return;
    lastPhoneOpRef.current = 'open-file';
    openDocs.showOpening(fileDocId(file.path), file.path);
    panes.setPane('doc');
    link.send(
      phoneCommand({
        op: 'open-file',
        chatId: id,
        path: file.path,
        ...(file.startLine != null ? { startLine: file.startLine } : {}),
        ...(file.endLine != null ? { endLine: file.endLine } : {}),
        ...(file.view === 'diff' ? { view: 'diff' } : {}),
      }),
    );
  }

  function requestDesktopImage(src: string) {
    const id = activeChatIdRef.current;
    const key = imageCacheKey(id ?? '', src);
    if (!id || requestedImagesRef.current.has(key)) return;
    requestedImagesRef.current.add(key);
    lastPhoneOpRef.current = 'media';
    pendingImageRef.current = key;
    link.send(phoneCommand({ op: 'media', chatId: id, path: src }));
  }

  function clearChatTools() {
    setFindOpen(false);
    setFindQuery('');
    setFindIndex(0);
    setTextToolId(null);
    selectionRef.current = '';
  }

  function openFind() {
    const next = seedChatSearchQuery('', textToolId ? selectionRef.current : '');
    setFindOpen(true);
    if (next && next !== findQuery) {
      setFindQuery(next);
      setFindIndex(0);
    }
  }

  function toggleFind() {
    if (findOpen) {
      setFindOpen(false);
      return;
    }
    openFind();
  }

  function openChat(chatId: string) {
    openDocs.closeAll(); setCodeRefs([]);
    panes.setPane('chat');
    setError(null);
    pinTranscriptRef.current = true;
    clearChatTools();
    setActiveChatId(chatId);
    screenRef.current = 'chat';
    setScreen('chat');
    link.send(phoneCommand({ op: 'open', chatId }));
  }

  function requestSources(repoPath: string, query?: string) {
    if (sourceQueryTimer.current) clearTimeout(sourceQueryTimer.current);
    sourceQueryTimer.current = setTimeout(() => {
      link.send(phoneCommand({ op: 'sources', repoPath, ...(query ? { query } : {}) }));
    }, query ? 250 : 0);
  }

  function requestModels(agent: AgentId) {
    if (modelsByAgent[agent]) return;
    link.send(phoneCommand({ op: 'models', agent }));
  }

  function stampFiles(picked: PickedFile[]): FileChip[] {
    return picked.map((file, index) => ({ ...file, id: `${Date.now()}-${index}-${file.name}` }));
  }

  async function addPicked(kind: 'camera' | 'photos' | 'files', target: 'chat' | 'create') {
    try {
      setError(null);
      const picked = kind === 'camera' ? await takePhoto() : kind === 'photos' ? await pickPhotos() : await pickDocuments();
      if (picked.length === 0) return;
      const next = stampFiles(picked);
      if (target === 'create') setCreateFiles((prev) => [...prev, ...next]);
      else setFiles((prev) => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleMic(apply: (text: string) => void) {
    try {
      setError(null);
      const current = recordingRef.current;
      if (current) {
        recordingRef.current = null;
        setListening(false);
        const audioBase64 = await stopMic(current);
        const id = `${Date.now()}`;
        dictateIdRef.current = id;
        dictateApplyRef.current = apply;
        link.send(phoneCommand({ op: 'dictate', id, audioBase64 }));
        return;
      }
      dictateApplyRef.current = apply;
      recordingRef.current = await startMic();
      setListening(true);
    } catch (err) {
      recordingRef.current = null;
      setListening(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openCreate(mode: CreateMode) {
    setError(null);
    setCreateDraft('');
    setCreateFiles([]);
    setCreateLinks([]);
    const options = composerOptionsFor(mode.kind, accountDefaultsRef.current);
    setCreateOptions(options);
    setSources(null);
    setCreateMode(mode);
    if (mode.kind === 'project') requestSources(mode.repoPath);
    requestModels(options.agent);
  }

  function submitCreate(body: {
    text: string;
    files: FileChip[];
    links: LinkChip[];
    options: ComposerOptions;
    selection: CreateSelection;
    cowboy: boolean;
  }) {
    const mode = createMode;
    if (!mode) return;
    if (mode.kind === 'orchestration' && !body.text && body.files.length === 0 && body.links.length === 0) {
      setError('Describe the orchestration goal.');
      return;
    }
    setError(null);
    const payloadFiles = body.files.map(({ name, dataBase64 }) => ({ name, dataBase64 }));
    const shared = {
      ...body.options,
      ...(body.text ? { prompt: body.text } : {}),
      ...(payloadFiles.length ? { files: payloadFiles } : {}),
      ...(body.links.length ? { links: body.links } : {}),
    };
    if (mode.kind === 'orchestration') {
      setPendingAdd('orchestration');
      link.send(phoneCommand({ op: 'create', where: 'orchestration', goal: body.text, ...shared }));
    } else if (mode.kind === 'worktree') {
      setPendingAdd(`worktree:${mode.chatId}`);
      link.send(phoneCommand({ op: 'create', where: 'worktree', chatId: mode.chatId, ...shared }));
    } else {
      const selection = body.cowboy ? { kind: 'default' as const } : body.selection;
      setPendingAdd(`project:${mode.repoPath}`);
      link.send(
        phoneCommand({
          op: 'create',
          where: 'project',
          repoPath: mode.repoPath,
          ...(body.cowboy ? { cowboy: true } : {}),
          ...(selection.kind === 'default'
            ? { sourceType: 'branch', sourceRef: 'default' }
            : {
                sourceType: selection.kind === 'ticket' ? 'ticket' : selection.kind,
                sourceRef: selection.ref,
                title: selection.title,
              }),
          ...shared,
        }),
      );
    }
    setCreateMode(null);
  }

  function archiveChat(chatId: string) {
    link.send(phoneCommand({ op: 'archive', chatId }));
  }

  function archiveOpenChat() {
    const id = activeChatIdRef.current;
    if (!id) return;
    archiveChat(id);
    showAgents();
  }

  function runHeaderAction() {
    if (!rightHeader || rightHeader === false || !rightHeader.action) return;
    const id = activeChatIdRef.current;
    if (!id) return;
    if (rightHeader.action === 'open-checks') {
      panes.selectPane('checks');
      return;
    }
    if (rightHeader.action === 'open-pr') {
      if (rightHeader.prUrl) void Linking.openURL(rightHeader.prUrl);
      return;
    }
    panes.setPane('chat');
    link.send(phoneCommand({ op: 'git', chatId: id, action: rightHeader.action }));
  }

  function showHistory() {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    setError(null);
    setHistoryQuery('');
    setHistory([]);
    historyNextRef.current = null;
    setHistoryTotal(0);
    screenRef.current = 'history';
    setScreen('history');
    sendHistory('');
  }

  function onHistoryQuery(value: string) {
    setHistoryQuery(value);
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      setHistory([]);
      historyNextRef.current = null;
      setHistoryTotal(0);
      sendHistory(value.trim());
    }, 250);
  }

  function restoreChat(chatId: string) {
    setError(null);
    setPendingRestore(chatId);
    link.send(phoneCommand({ op: 'restore', chatId }));
  }

  function addCodeRef(ref: PhoneCodeSelection) {
    setCodeRefs((prev) => [...prev, { ...ref, id: `${Date.now()}-${prev.length}` }]);
    panes.setPane('chat');
  }

  function sendText(text: string) {
    const body = text.trim();
    const id = activeChatIdRef.current;
    const extras = phoneSendExtras(files, links, codeRefs);
    const stopping = body.toLowerCase() === 'stop';
    if ((!body && !extras.attached) || !id) return;
    const bubble = [body, ...extras.names].filter(Boolean).join('\n');
    if (!stopping) pinTranscriptRef.current = true;
    setTranscripts((prev) => {
      const current = prev[id] ?? EMPTY;
      return {
        ...prev,
        [id]: stopping
          ? {
              ...current,
              bubbles: settleBubbles(current.bubbles),
              questions: null,
              working: false,
              activity: '',
            }
          : {
              bubbles: pushBubble(settleBubbles(current.bubbles), 'user', bubble),
              questions: null,
              working: true,
              activity: '',
            },
      };
    });
    if (!stopping) {
      setDraft('');
      setFiles([]);
      setLinks([]); setCodeRefs([]);
      patchChat(id, { status: 'running', updatedAt: new Date().toISOString() });
    }
    const options = chatOptions[id];
    const payload = stopping
      ? phoneCommand({ op: 'stop', chatId: id })
      : phoneCommand({
          op: 'prompt',
          chatId: id,
          text: body,
          ...extras.payload,
          ...(options ?? {}),
        });
    if (attachedRef.current) {
      link.send(payload);
      return;
    }
    pendingSendRef.current = payload;
    const desktopId = activeIdRef.current;
    const desktop = desktopId ? desktopsRef.current.find((row) => row.deviceId === desktopId) : undefined;
    const token = desktop?.sessionToken ?? pendingTokenRef.current;
    if (token) link.send({ type: 'resume', sessionToken: token });
    link.scheduleResume();
  }

  useEffect(() => {
    let cancelled = false;
    void loadDesktops().then((saved) => {
      if (cancelled) return;
      if (saved.length === 0) {
        setScreen('pair');
        return;
      }
      const rows = saved.map((row) => ({ ...row, online: null, expired: false }));
      setDesktops(rows);
      setScreen('desktops');
      checkingHostsRef.current = true;
      link.send({ type: 'list_hosts', sessionTokens: rows.map((row) => row.sessionToken) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = useMemo(() => {
    const rank = (desktop: Desktop) => (desktop.online ? 0 : desktop.expired ? 2 : 1);
    return [...desktops].sort(
      (a, b) => rank(a) - rank(b) || a.deviceLabel.localeCompare(b.deviceLabel),
    );
  }, [desktops]);

  const active = desktops.find((row) => row.deviceId === activeId) ?? null;
  const activeChat =
    orchestration.find((row) => row.id === activeChatId) ??
    projects.flatMap((project) => project.worktrees.flatMap((worktree) => worktree.chats)).find((row) => row.id === activeChatId) ??
    null;
  const activeWorktree = projects
    .flatMap((project) => project.worktrees)
    .find((worktree) => worktree.chats.some((chat) => chat.id === activeChatId));
  const activeIsProject = Boolean(activeWorktree);
  const listedPr = activeChat?.prNumber
    ? {
        ...(activeChat.prUrl ? { prUrl: activeChat.prUrl } : {}),
        prNumber: activeChat.prNumber,
        ...(activeChat.prStatus ? { prStatus: activeChat.prStatus } : {}),
      }
    : null;
  const chatHeader: PhoneRightHeader | null =
    !activeIsProject || rightHeader === false
      ? null
      : rightHeader
        ? rightHeader.prNumber
          ? rightHeader
          : { ...rightHeader, ...(listedPr ?? {}) }
        : activeWorktree
          ? {
              branch: activeWorktree.label,
              additions: 0,
              deletions: 0,
              unpushed: 0,
              dirty: false,
              ready: false,
              title: activeWorktree.label,
              ...(listedPr ?? {}),
            }
          : null;
  const activeRepoPath =
    projects.find((project) =>
      project.worktrees.some((worktree) => worktree.chats.some((chat) => chat.id === activeChatId)),
    )?.path ?? null;
  const activeOptions = (activeChatId && chatOptions[activeChatId]) || DEFAULT_OPTIONS;
  function patchActiveOptions(next: ComposerOptions) {
    const id = activeChatIdRef.current;
    if (!id || !link) return;
    setChatOptions((prev) => ({ ...prev, [id]: next }));
    link.send(phoneCommand({ op: 'options', chatId: id, ...next }));
  }
  const transcript = (activeChatId && transcripts[activeChatId]) || EMPTY;
  const findHits = useMemo(
    () => (findOpen ? findBubbleSearchHits(findQuery, transcript.bubbles, paintedFindStrings) : []),
    [findOpen, findQuery, transcript.bubbles],
  );
  const findSafeIndex = findHits.length ? findIndex % findHits.length : 0;
  const findPlace = findHits.map((hit) => `${hit.id}:${hit.local}`).join('|');

  useEffect(() => {
    if (!findOpen) return;
    const hit = findHits[findSafeIndex];
    if (!hit) return;
    pinTranscriptRef.current = false;
    const y = bubbleY.current[hit.id];
    if (y == null) return;
    transcriptScrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  }, [findOpen, findSafeIndex, findPlace]);

  if (screen === 'loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <Brand />
      </SafeAreaView>
    );
  }

  if (screen === 'desktops') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Brand />
          <Text style={styles.title}>Choose a desktop</Text>
          <Text style={styles.hint}>
            Pair each Mac from Settings → Remote. The name you save there is the name in this list.
          </Text>
        </View>
        <ScrollView style={styles.transcript} contentContainerStyle={styles.listPad}>
          {ordered.map((desktop) => (
            <View key={desktop.sessionToken} style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => choose(desktop)}>
                <Text style={styles.rowTitle}>{desktop.deviceLabel}</Text>
                <View style={styles.statusRow}>
                  <View
                    style={[
                      styles.dot,
                      desktop.online ? styles.dotOn : desktop.expired ? styles.dotWarn : styles.dotOff,
                    ]}
                  />
                  <Text style={styles.status}>{desktopStatus(desktop)}</Text>
                </View>
              </Pressable>
              <Pressable style={styles.ghost} onPress={() => forget(desktop.deviceId)}>
                <Text style={styles.ghostText}>Forget</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
        {error && !checkingHostsRef.current ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.footer}>
          <Pressable style={styles.primary} onPress={() => { setError(null); setScreen('pair'); }}>
            <Text style={styles.primaryText}>Pair another Mac</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === 'pair') {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SafeAreaView style={styles.screen}>
          <StatusBar style="light" />
          <View style={styles.header}>
            {desktops.length > 0 ? (
              <Pressable onPress={showDesktops}>
                <Text style={styles.link}>Desktops</Text>
              </Pressable>
            ) : (
              <Brand />
            )}
            <Text style={styles.title}>Pair a Mac</Text>
            <Text style={styles.hint}>
              On the Mac, open Sideboard → Settings → Remote, name it, then show a pairing code.
            </Text>
          </View>
          <View style={styles.form}>
            <Text style={styles.label}>Pairing code</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="CODE"
              placeholderTextColor={palette.muted}
              value={code}
              onChangeText={setCode}
            />
            <Text style={styles.label}>Relay</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              value={url}
              onChangeText={setUrl}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.primary, !code.trim() && styles.primaryDisabled]}
              onPress={() => {
                const next = code.trim().toUpperCase();
                if (!next) return;
                setError(null);
                pendingTokenRef.current = null;
                link.send({ type: 'pair', code: next });
              }}
            >
              <Text style={styles.primaryText}>Pair</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    );
  }

  if (screen === 'agents') {
    return (
      <PhoneAgentsScreen
        deviceLabel={active?.deviceLabel || 'Chats'}
        error={error}
        showOrchestration={showOrchestration}
        orchestration={visibleOrchestration}
        pendingAdd={pendingAdd}
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen((open) => !open)}
        query={sidebarQuery}
        onQuery={setSidebarQuery}
        tagChoices={tagChoices}
        tagFilters={tagFilters}
        onToggleTag={toggleSidebarTag}
        onClearTags={() => setTagFilters([])}
        filtering={sidebarFiltering}
        projects={visibleProjects}
        onOpenCreate={openCreate}
        onOpenChat={openChat}
        onArchiveChat={archiveChat}
        onDesktops={showDesktops}
        onHistory={showHistory}
        create={
          createMode
            ? {
                mode: createMode,
                sources,
                draft: createDraft,
                onChangeDraft: setCreateDraft,
                files: createFiles,
                links: createLinks,
                onRemoveFile: (id) => setCreateFiles((prev) => prev.filter((file) => file.id !== id)),
                onRemoveLink: (ref) => setCreateLinks((prev) => prev.filter((link) => link.ref !== ref)),
                options: createOptions,
                onChangeOptions: setCreateOptions,
                models: modelsByAgent[createOptions.agent] ?? [],
                onNeedModels: requestModels,
                listening,
                onClose: () => setCreateMode(null),
                onSubmit: submitCreate,
                onRequestSources: (query) => {
                  if (createMode.kind === 'project') requestSources(createMode.repoPath, query);
                },
                onMic: () =>
                  void toggleMic((spoken) => {
                    setCreateDraft((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken));
                  }),
                onCamera: () => void addPicked('camera', 'create'),
                onPhotos: () => void addPicked('photos', 'create'),
                onFiles: () => void addPicked('files', 'create'),
              }
            : null
        }
      />
    );
  }


  if (screen === 'history') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.chrome}>
          <Pressable onPress={showAgents} hitSlop={8}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
          <Text style={styles.chromeTitle} numberOfLines={1}>
            History
          </Text>
        </View>
        <View style={[styles.form, styles.historyForm]}>
          <Text style={[styles.hint, styles.historyLead]}>
            Archived chats from this Mac. Restore puts one back on the sidebar. The git branch stays.
          </Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Filter by title, project, or agent"
            placeholderTextColor={palette.muted}
            value={historyQuery}
            onChangeText={onHistoryQuery}
          />
          <Text style={styles.meta}>
            {historyLoading && history.length === 0
              ? 'Loading…'
              : historyCount(historyTotal, historyQuery.trim().length > 0)}
          </Text>
        </View>
        <FlatList
          style={styles.transcript}
          data={history}
          keyExtractor={(chat) => chat.id}
          contentContainerStyle={styles.listPad}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreHistory}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            historyLoading ? null : (
              <Text style={styles.meta}>
                {historyQuery.trim()
                  ? 'No archived chats match that search.'
                  : 'No archived chats yet.'}
              </Text>
            )
          }
          ListFooterComponent={
            historyLoading && history.length > 0 ? <Text style={styles.meta}>Loading more…</Text> : null
          }
          renderItem={({ item }) => (
            <HistoryRow
              chat={item}
              busy={pendingRestore !== null}
              pending={pendingRestore === item.id}
              onRestore={() => restoreChat(item.id)}
            />
          )}
        />
        {error ? <Text style={[styles.error, styles.errorPad]}>{error}</Text> : null}
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.chrome}>
          <Pressable onPress={showAgents} hitSlop={8}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
          <View style={[styles.titleRow, styles.titleFlex]}>
            <AgentKindIcon agent={activeChat?.agent || chatOptions[activeChatId ?? '']?.agent || ''} />
            <Text style={styles.chromeTitle} numberOfLines={1}>
              {activeChat?.title || 'Agent'}
            </Text>
          </View>
          <View style={styles.chromeActions}>
            <Pressable
              onPress={toggleFind}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Find in chat"
            >
              <SearchGlyph active={findOpen} />
            </Pressable>
            {transcript.working ? (
              <Pressable onPress={() => sendText('stop')} hitSlop={8}>
                <Text style={styles.link}>Stop</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <PhoneWorkspace
          pane={panes.pane}
          docs={openDocs.docs}
          activeDocId={openDocs.activeId}
          side={panes.side}
          header={chatHeader}
          onSelect={panes.selectPane}
          onReview={panes.askReview}
          onSelectDoc={(id) => {
            openDocs.select(id);
            panes.setPane('doc');
          }}
          onOpenPath={openDesktopFile}
          onAddCodeRef={addCodeRef}
          onCloseDoc={(id) => {
            const next = openDocs.close(id);
            if (!next && panes.pane === 'doc') panes.setPane('chat');
          }}
          fileQuery={panes.fileQuery}
          onFileQuery={panes.setFileSearch}
          onHeaderAction={runHeaderAction}
          onHeaderArchive={archiveOpenChat}
        >
        {findOpen ? (
          <ChatFindBar
            query={findQuery}
            index={findSafeIndex}
            total={findHits.length}
            onQuery={(next) => {
              setFindQuery(next);
              setFindIndex(0);
            }}
            onNext={() => setFindIndex((i) => nextChatSearchIndex(i, findHits.length, 1))}
            onPrev={() => setFindIndex((i) => nextChatSearchIndex(i, findHits.length, -1))}
            onClose={() => setFindOpen(false)}
          />
        ) : null}
        <ScrollView
          ref={transcriptScrollRef}
          style={styles.transcript}
          scrollEventThrottle={16}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            pinTranscriptRef.current =
              contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
          }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (pinTranscriptRef.current && textToolId == null) {
              transcriptScrollRef.current?.scrollToEnd({ animated: false });
            }
          }}
          contentContainerStyle={
            transcript.bubbles.length === 0 && !transcript.working && !transcript.questions
              ? styles.emptyFill
              : styles.listPad
          }
        >
          {transcript.bubbles.length === 0 && !transcript.working && !transcript.questions ? (
            <EmptyChat project={activeIsProject} />
          ) : null}
          {transcript.bubbles.map((bubble) => {
            const selecting = textToolId === bubble.id;
            const selectBubble = () => {
              selectionRef.current = bubble.text;
              setTextToolId(bubble.id);
            };
            return (
              <View
                key={bubble.id}
                onLayout={(event) => {
                  bubbleY.current[bubble.id] = event.nativeEvent.layout.y;
                }}
                style={[styles.bubble, bubble.role === 'user' ? styles.user : styles.agent]}
              >
                {selecting ? (
                  <>
                    <MessageTextTool text={bubble.text} selectionRef={selectionRef} />
                    <Pressable
                      onPress={() => {
                        setTextToolId(null);
                        selectionRef.current = '';
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Done selecting"
                    >
                      <Text style={styles.selectDone}>Done</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    onLongPress={selectBubble}
                    delayLongPress={350}
                  >
                    <MarkdownText
                      text={bubble.text}
                      tone={bubble.role === 'user' ? 'user' : 'agent'}
                      streaming={bubble.streaming === true}
                      chatId={activeChatId ?? ''}
                      onChatLink={openChat}
                      onFileLink={openDesktopFile}
                      onArtifact={openDesktopArtifact}
                      onLocalImage={requestDesktopImage}
                      onLongPress={selectBubble}
                      findQuery={findOpen ? findQuery : ''}
                      findLocal={currentLocalIndex(findHits, findSafeIndex, bubble.id)}
                    />
                  </Pressable>
                )}
              </View>
            );
          })}
          {transcript.working ? (
            <StreamStatus
              verb={streamVerb(
                transcript.activity,
                transcript.bubbles.some((bubble) => bubble.streaming && bubble.text.trim().length > 0),
              )}
            />
          ) : null}
          {transcript.questions?.map((question) => (
            <View key={question.question} style={styles.ask}>
              <MarkdownText text={question.question} tone="ask" chatId={activeChatId ?? ''} onChatLink={openChat} />
              {question.options.map((option, index) => (
                <Pressable key={option.label} style={styles.option} onPress={() => sendText(option.label)}>
                  <View style={styles.optionNum}>
                    <Text style={styles.optionNumText}>{index + 1}</Text>
                  </View>
                  <View style={styles.optionBody}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    {option.description ? <Text style={styles.optionDesc}>{option.description}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
        {error ? <Text style={[styles.error, styles.errorPad]}>{error}</Text> : null}
        <PhoneCodeRefChips refs={codeRefs} onRemove={(id) => setCodeRefs((prev) => prev.filter((row) => row.id !== id))} />
        <ComposerDock
          draft={draft}
          placeholder={composerPlaceholder({
            orchestration: orchestration.some((row) => row.id === activeChatId),
            status: activeChat?.status,
          })}
          onChangeDraft={setDraft}
          onSend={() => sendText(draft)}
          files={files}
          links={links}
          allowEmpty={codeRefs.length > 0}
          onRemoveFile={(id) => setFiles((prev) => prev.filter((file) => file.id !== id))}
          onRemoveLink={(ref) => setLinks((prev) => prev.filter((link) => link.ref !== ref))}
          options={activeOptions}
          onChangeOptions={patchActiveOptions}
          models={modelsByAgent[activeOptions.agent] ?? []}
          onNeedModels={requestModels}
          allowBrightsy={activeIsProject}
          listening={listening}
          onMic={() =>
            void toggleMic((spoken) => {
              setDraft((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken));
            })
          }
          onCamera={() => void addPicked('camera', 'chat')}
          onPhotos={() => void addPicked('photos', 'chat')}
          onFiles={() => void addPicked('files', 'chat')}
          onLinkIssue={
            activeRepoPath
              ? () => {
                  setSources(null);
                  setIssuePickerFor(activeRepoPath);
                  requestSources(activeRepoPath);
                }
              : undefined
          }
        />
        {issuePickerFor ? (
          <IssuePicker
            sources={sources}
            onClose={() => setIssuePickerFor(null)}
            onSearch={(query) => requestSources(issuePickerFor, query)}
            onPick={(issue) => {
              setLinks((prev) =>
                prev.some((link) => link.ref === issue.ref)
                  ? prev
                  : [...prev, { ref: issue.ref, title: issue.title, url: issue.url }],
              );
              setIssuePickerFor(null);
            }}
          />
        ) : null}
        </PhoneWorkspace>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

