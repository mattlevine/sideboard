import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
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
  CreateChatSheet,
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
import { imageCacheKey, publishImage } from './media-cache';
import { EmptyChat } from './empty-chat';
import { MarkdownText, streamVerb, type ArtifactLink } from './markdown';
import { createRelayLink, type RelayLink } from './relay-link';
import { AgentKindIcon } from './agent-icons';
import { ProjectGlyph, WorktreeStatusIcon, worktreeStatusKind } from './sidebar-icons';
import { palette, styles } from './styles';
import { useTransientError } from './transient-error';
import { composerOptionsFor, type PhoneAccountDefaults } from './account-defaults';
import { agentStatus, composerPlaceholder, desktopStatus, historyCount, onMac } from './labels';
import { openedTranscript } from './transcript';

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
type PhoneChat = {
  id: string;
  title: string;
  status: string;
  preview: string;
  updatedAt: string;
  agent?: string;
};
type PhoneWorktree = { label: string; chats: PhoneChat[]; tags?: string[] };
type PhoneProject = { name: string; path: string; worktrees: PhoneWorktree[] };
type PhonePlace =
  | { kind: 'orchestration' }
  | { kind: 'project'; repoPath: string; worktree: string };
type PhoneHistoryChat = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  where: string;
  agent: string;
};
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
  | ({ op: 'options'; chatId: string } & ComposerOptions);

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

function pushBubble(bubbles: Bubble[], role: Bubble['role'], text: string): Bubble[] {
  if (!text.trim()) return bubbles;
  return [...bubbles, { id: `${Date.now()}-${bubbles.length}`, role, text }];
}

function settleBubbles(bubbles: Bubble[]): Bubble[] {
  if (!bubbles.some((bubble) => bubble.streaming)) return bubbles;
  return bubbles.map((bubble) => (bubble.streaming ? { ...bubble, streaming: false } : bubble));
}

function applyStream(current: Transcript, text: string, activity: string): Transcript {
  const bubbles = current.bubbles.slice();
  const trimmed = text.trim();
  if (trimmed) {
    const last = bubbles[bubbles.length - 1];
    if (last?.streaming) bubbles[bubbles.length - 1] = { ...last, text: trimmed };
    else bubbles.push({ id: `live-${Date.now()}-${bubbles.length}`, role: 'agent', text: trimmed, streaming: true });
  }
  return { ...current, bubbles, questions: null, working: true, activity };
}

function finishAgent(bubbles: Bubble[], text: string): Bubble[] {
  const trimmed = text.trim();
  const last = bubbles[bubbles.length - 1];
  if (last?.streaming) {
    if (!trimmed) return bubbles.slice(0, -1);
    return [...bubbles.slice(0, -1), { ...last, text: trimmed, streaming: false }];
  }
  return pushBubble(bubbles, 'agent', trimmed);
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

/** Same mark as the desktop sidebar: outline cube over a blue offset plate. */
function BrandMark({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const sm = size === 'sm';
  const frame = sm ? 22 : 36;
  const box = sm ? 14 : 22;
  const shift = sm ? 2.5 : 3.5;
  const radius = sm ? 3 : 4;
  const inset = (frame - box) / 2;
  return (
    <View style={{ width: frame, height: frame }}>
      <View
        style={{
          position: 'absolute',
          left: inset,
          top: inset,
          width: box,
          height: box,
          borderRadius: radius,
          backgroundColor: '#004070',
          transform: [{ rotate: '14deg' }, { translateX: shift }, { translateY: shift }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: inset,
          top: inset,
          width: box,
          height: box,
          borderRadius: radius,
          borderWidth: sm ? 1.75 : 2,
          borderColor: palette.text,
          backgroundColor: 'transparent',
          transform: [{ rotate: '14deg' }],
        }}
      />
    </View>
  );
}

function Brand() {
  return (
    <View style={styles.brand}>
      <BrandMark size="md" />
      <Text style={styles.brandName}>Sideboard</Text>
    </View>
  );
}

/** Desktop live row: spinning mark, shimmer verb, and the three dots. */
function StreamStatus({ verb }: { verb: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  const wave = useRef(new Animated.Value(0)).current;
  const dotA = useRef(new Animated.Value(0.35)).current;
  const dotB = useRef(new Animated.Value(0.35)).current;
  const dotC = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const waveLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(wave, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(wave, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 450, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.35, duration: 450, useNativeDriver: true }),
          Animated.delay(300),
        ]),
      );
    const dots = [pulse(dotA, 0), pulse(dotB, 150), pulse(dotC, 300)];
    spinLoop.start();
    waveLoop.start();
    for (const loop of dots) loop.start();
    return () => {
      spinLoop.stop();
      waveLoop.stop();
      for (const loop of dots) loop.stop();
    };
  }, [spin, wave, dotA, dotB, dotC]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const color = wave.interpolate({ inputRange: [0, 1], outputRange: [palette.muted, palette.text] });
  return (
    <View style={styles.streamRow} accessibilityRole="text" accessibilityLabel={verb || 'Generating'}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <BrandMark size="sm" />
      </Animated.View>
      {verb ? (
        <Animated.Text style={[styles.streamVerb, { color }]} numberOfLines={2}>
          {verb}
        </Animated.Text>
      ) : (
        <View style={styles.streamVerb} />
      )}
      <View style={styles.streamDots}>
        {[dotA, dotB, dotC].map((dot, index) => (
          <Animated.View key={index} style={[styles.streamDot, { opacity: dot }]} />
        ))}
      </View>
    </View>
  );
}

function ChatRow({
  chat,
  onOpen,
  onArchive,
}: {
  chat: PhoneChat;
  onOpen: () => void;
  onArchive: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onOpen}>
        <View style={styles.titleRow}>
          <AgentKindIcon agent={chat.agent || ''} />
          <Text style={[styles.rowTitle, styles.titleFlex]} numberOfLines={1}>{chat.title}</Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>{chat.preview || 'No messages yet'}</Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.dot,
              chat.status === 'running' || chat.status === 'queued'
                ? styles.dotRun
                : chat.status === 'error' || chat.status === 'broken'
                  ? styles.dotErr
                  : styles.dotOff,
            ]}
          />
          <Text style={styles.status}>{agentStatus(chat.status)}</Text>
        </View>
      </Pressable>
      <Pressable
        style={styles.ghost}
        onPress={onArchive}
        accessibilityRole="button"
        accessibilityLabel={`Archive ${chat.title}. It stays in History.`}
      >
        <Text style={styles.ghostText}>Archive</Text>
      </Pressable>
    </View>
  );
}

function HistoryRow({
  chat,
  busy,
  pending,
  onRestore,
}: {
  chat: PhoneHistoryChat;
  busy: boolean;
  pending: boolean;
  onRestore: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.titleRow}>
          <AgentKindIcon agent={chat.agent} />
          <Text style={[styles.rowTitle, styles.titleFlex]} numberOfLines={1}>{chat.title}</Text>
        </View>
        {chat.preview ? (
          <Text style={styles.preview} numberOfLines={1}>
            {chat.preview}
          </Text>
        ) : null}
        <Text style={styles.status}>
          {chat.where} · {chat.agent}
        </Text>
      </View>
      <Pressable
        style={styles.ghost}
        onPress={onRestore}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Restore ${chat.title}`}
      >
        <Text style={styles.ghostText}>{pending ? '…' : 'Restore'}</Text>
      </Pressable>
    </View>
  );
}

function AddButton({
  label,
  hint,
  busy,
  onPress,
}: {
  label: string;
  hint: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.addAgent}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={hint}
    >
      <Text style={styles.addAgentPlus}>{busy ? '…' : '+'}</Text>
      <Text style={styles.addAgentText}>{busy ? 'Creating' : label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [code, setCode] = useState('');
  const [desktops, setDesktops] = useState<Desktop[]>([]);
  const [screen, setScreen] = useState<Screen>('loading');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [orchestration, setOrchestration] = useState<PhoneChat[]>([]);
  const [projects, setProjects] = useState<PhoneProject[]>([]);
  const [history, setHistory] = useState<PhoneHistoryChat[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({});
  const [draft, setDraft] = useState('');
  const [error, setError] = useTransientError();
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [files, setFiles] = useState<FileChip[]>([]);
  const [links, setLinks] = useState<LinkChip[]>([]);
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

  const desktopsRef = useRef(desktops);
  const activeIdRef = useRef(activeId);
  const activeChatIdRef = useRef(activeChatId);
  const lastPhoneOpRef = useRef<string | null>(null);
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
      onError: (message) => {
        if (screenRef.current === 'desktops' && checkingHostsRef.current) return;
        setError(message);
      },
      onClose: () => {
        attachedRef.current = false;
        if (screenRef.current === 'desktops' && checkingHostsRef.current) {
          checkingHostsRef.current = false;
          setError('Could not reach the relay.');
        }
      },
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
        ? control.projects.filter((project) => project?.name && Array.isArray(project.worktrees))
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
      setPendingAdd(null);
      setCreateMode(null);
      if (control.options) {
        setChatOptions((prev) => ({ ...prev, [chat.id]: control.options! }));
      }
      rememberOpened(chat, control.place);
      setActiveChatId(chat.id);
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
    if (control.op === 'error') {
      const askedMac = lastPhoneOpRef.current === 'media' || lastPhoneOpRef.current === 'open-file';
      if (control.message === 'invalid phone command' && askedMac) {
        const openedFile = lastPhoneOpRef.current === 'open-file';
        if (pendingImageRef.current) publishImage(pendingImageRef.current, null);
        pendingImageRef.current = null;
        lastPhoneOpRef.current = null;
        if (openedFile) {
          setError('This Mac’s Sideboard app can’t open that from the phone yet.');
        }
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
    link.send(
      phoneCommand({
        op: 'open-file',
        chatId: id,
        path: file.path,
        ...(file.startLine != null ? { startLine: file.startLine } : {}),
        ...(file.endLine != null ? { endLine: file.endLine } : {}),
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

  function openChat(chatId: string) {
    setError(null);
    pinTranscriptRef.current = true;
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

  function sendText(text: string) {
    const body = text.trim();
    const id = activeChatIdRef.current;
    const attached = files.length > 0 || links.length > 0;
    if ((!body && !attached) || !id) return;
    const stopping = body.toLowerCase() === 'stop';
    const bubble = [body, ...files.map((file) => file.name), ...links.map((link) => link.ref)]
      .filter(Boolean)
      .join('\n');
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
      setLinks([]);
      patchChat(id, { status: 'running', updatedAt: new Date().toISOString() });
    }
    const options = chatOptions[id];
    const payload = stopping
      ? phoneCommand({ op: 'stop', chatId: id })
      : phoneCommand({
          op: 'prompt',
          chatId: id,
          text: body,
          ...(files.length ? { files: files.map(({ name, dataBase64 }) => ({ name, dataBase64 })) } : {}),
          ...(links.length ? { links } : {}),
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
  const activeIsProject = projects.some((project) =>
    project.worktrees.some((worktree) => worktree.chats.some((chat) => chat.id === activeChatId)),
  );
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
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.chrome}>
          <BrandMark />
          <Text style={styles.chromeTitle} numberOfLines={1}>
            {active?.deviceLabel || 'Chats'}
          </Text>
          <Pressable onPress={showDesktops} hitSlop={8}>
            <Text style={styles.link}>Desktops</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.transcript} contentContainerStyle={styles.listPad}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>Orchestration</Text>
            <AddButton
              label="New agent"
              hint="Add orchestration agent"
              busy={pendingAdd === 'orchestration'}
              onPress={() => openCreate({ kind: 'orchestration' })}
            />
          </View>
          {orchestration.length === 0 ? <Text style={styles.meta}>No agents yet</Text> : null}
          {orchestration.map((chat) => (
            <ChatRow key={chat.id} chat={chat} onOpen={() => openChat(chat.id)} onArchive={() => archiveChat(chat.id)} />
          ))}
          <View style={[styles.sectionRow, styles.projectsHead]}>
            <Text style={styles.sectionLabel}>Projects</Text>
          </View>
          {projects.length === 0 ? <Text style={styles.meta}>No projects yet</Text> : null}
          {projects.map((project) => (
            <View key={project.path} style={styles.projectBlock}>
              <View style={styles.sectionRow}>
                <View style={styles.glyphRow}>
                  <ProjectGlyph />
                  <Text style={styles.projectName} numberOfLines={1}>
                    {project.name}
                  </Text>
                </View>
                <AddButton
                  label="New worktree"
                  hint={`New worktree in ${project.name}`}
                  busy={pendingAdd === `project:${project.path}`}
                  onPress={() => openCreate({ kind: 'project', repoPath: project.path, name: project.name })}
                />
              </View>
              {project.worktrees.length === 0 ? <Text style={styles.meta}>No workspaces</Text> : null}
              {project.worktrees.map((worktree) => {
                const anchor = worktree.chats[0];
                return (
                  <View key={`${project.path}:${worktree.label}`} style={styles.worktreeBlock}>
                    <View style={styles.sectionRow}>
                      <View style={styles.glyphRow}>
                        <WorktreeStatusIcon kind={worktreeStatusKind(worktree.chats)} />
                        <Text style={styles.worktreeName} numberOfLines={1}>
                          {worktree.label}
                        </Text>
                      </View>
                      {anchor ? (
                        <AddButton
                          label="Add agent"
                          hint={`Add agent to ${worktree.label}`}
                          busy={pendingAdd === `worktree:${anchor.id}`}
                          onPress={() => openCreate({ kind: 'worktree', chatId: anchor.id, label: worktree.label })}
                        />
                      ) : null}
                    </View>
                    {worktree.tags?.length ? (
                      <View style={styles.tagRow}>{worktree.tags.map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View>
                    ) : null}
                    {worktree.chats.map((chat) => (
                      <ChatRow
                        key={chat.id}
                        chat={chat}
                        onOpen={() => openChat(chat.id)}
                        onArchive={() => archiveChat(chat.id)}
                      />
                    ))}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
        {error ? <Text style={[styles.error, styles.errorPad]}>{error}</Text> : null}
        <View style={styles.footer}>
          <Pressable style={styles.historyButton} onPress={showHistory} accessibilityRole="button">
            <Text style={styles.link}>Archived chats</Text>
          </Pressable>
        </View>
        {createMode ? (
          <CreateChatSheet
            mode={createMode}
            sources={sources}
            draft={createDraft}
            onChangeDraft={setCreateDraft}
            files={createFiles}
            links={createLinks}
            onRemoveFile={(id) => setCreateFiles((prev) => prev.filter((file) => file.id !== id))}
            onRemoveLink={(ref) => setCreateLinks((prev) => prev.filter((link) => link.ref !== ref))}
            options={createOptions}
            onChangeOptions={setCreateOptions}
            models={modelsByAgent[createOptions.agent] ?? []}
            onNeedModels={requestModels}
            listening={listening}
            onClose={() => setCreateMode(null)}
            onSubmit={submitCreate}
            onRequestSources={(query) => {
              if (createMode.kind === 'project') requestSources(createMode.repoPath, query);
            }}
            onMic={() =>
              void toggleMic((spoken) => {
                setCreateDraft((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken));
              })
            }
            onCamera={() => void addPicked('camera', 'create')}
            onPhotos={() => void addPicked('photos', 'create')}
            onFiles={() => void addPicked('files', 'create')}
          />
        ) : null}
      </SafeAreaView>
    );
  }

  if (screen === 'history') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.chrome}>
          <Pressable onPress={showAgents} hitSlop={8}>
            <Text style={styles.link}>Chats</Text>
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
            <Text style={styles.link}>Chats</Text>
          </Pressable>
          <View style={[styles.titleRow, styles.titleFlex]}>
            <AgentKindIcon agent={activeChat?.agent || chatOptions[activeChatId ?? '']?.agent || ''} />
            <Text style={styles.chromeTitle} numberOfLines={1}>
              {activeChat?.title || 'Agent'}
            </Text>
          </View>
          {transcript.working ? (
            <Pressable onPress={() => sendText('stop')} hitSlop={8}>
              <Text style={styles.link}>Stop</Text>
            </Pressable>
          ) : (
            <View style={styles.chromeMark} />
          )}
        </View>
        <ScrollView
          ref={transcriptScrollRef}
          style={styles.transcript}
          scrollEventThrottle={16}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            pinTranscriptRef.current =
              contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
          }}
          onContentSizeChange={() => {
            if (pinTranscriptRef.current) transcriptScrollRef.current?.scrollToEnd({ animated: false });
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
          {transcript.bubbles.map((bubble) => (
            <View
              key={bubble.id}
              style={[styles.bubble, bubble.role === 'user' ? styles.user : styles.agent]}
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
              />
            </View>
          ))}
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
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

