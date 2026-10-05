import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { loadDesktops, saveDesktops, type SavedDesktop } from './desktops';
import { createRelayLink, type RelayLink } from './relay-link';

const DEFAULT_URL = 'wss://relay.sideboard.cloud/remote';

type AskOption = { label: string; description?: string };
type AskQuestion = { question: string; options: AskOption[] };
type Bubble = { id: string; role: 'user' | 'agent'; text: string };
type Desktop = SavedDesktop & { online: boolean | null; expired: boolean };
type Transcript = { bubbles: Bubble[]; questions: AskQuestion[] | null; working: boolean };
type Screen = 'loading' | 'desktops' | 'pair' | 'chat';

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

function statusLabel(desktop: Desktop): string {
  if (desktop.expired) return 'Pair again';
  if (desktop.online === null) return 'Checking…';
  return desktop.online ? 'Online' : 'Offline';
}

export default function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [code, setCode] = useState('');
  const [desktops, setDesktops] = useState<Desktop[]>([]);
  const [screen, setScreen] = useState<Screen>('loading');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({});
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const desktopsRef = useRef(desktops);
  const activeIdRef = useRef(activeId);
  const urlRef = useRef(url);
  const pendingTokenRef = useRef<string | null>(null);
  const screenRef = useRef(screen);
  const attachedRef = useRef(false);
  const pendingSendRef = useRef<object | null>(null);
  const onMessageRef = useRef<(raw: string) => void>(() => undefined);
  const linkRef = useRef<RelayLink | null>(null);
  desktopsRef.current = desktops;
  activeIdRef.current = activeId;
  urlRef.current = url;
  screenRef.current = screen;
  if (!linkRef.current) {
    linkRef.current = createRelayLink({
      url: () => urlRef.current.trim() || DEFAULT_URL,
      onMessage: (raw) => onMessageRef.current(raw),
      onError: (message) => setError(message),
      onClose: () => {
        attachedRef.current = false;
      },
      attached: () => attachedRef.current,
      inChat: () => screenRef.current === 'chat',
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

  onMessageRef.current = (raw: string) => {
    const msg = parseServer(raw);
    if (!msg) return;
    if (msg.type === 'hosts') {
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
      setScreen('chat');
      setTranscripts((prev) => ({
        ...prev,
        [desktop.deviceId]: { ...(prev[desktop.deviceId] ?? EMPTY), working: Boolean(pending) },
      }));
      if (pending) link.send(pending);
      return;
    }
    if (msg.type === 'assistant' || msg.type === 'ask_user') {
      const id = activeIdRef.current;
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
      const token = pendingTokenRef.current;
      if (token) patchDesktop(token, { online: false });
      setError(
        screenRef.current === 'chat'
          ? 'That Mac is offline. Reconnecting…'
          : 'That Mac is offline. Open Sideboard on it, then choose it again.',
      );
      const id = activeIdRef.current;
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

  function sendText(text: string) {
    const body = text.trim();
    const id = activeIdRef.current;
    if (!body || !id) return;
    setTranscripts((prev) => {
      const current = prev[id] ?? EMPTY;
      return {
        ...prev,
        [id]: {
          bubbles: pushBubble(current.bubbles, 'user', body),
          questions: null,
          working: true,
        },
      };
    });
    setDraft('');
    const payload = body.toLowerCase() === 'stop' ? { type: 'stop' } : { type: 'prompt', text: body };
    if (attachedRef.current) {
      link.send(payload);
      return;
    }
    pendingSendRef.current = payload;
    const desktop = desktopsRef.current.find((row) => row.deviceId === id);
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
  const transcript = (activeId && transcripts[activeId]) || EMPTY;

  if (screen === 'loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <Text style={styles.title}>Sideboard</Text>
      </SafeAreaView>
    );
  }

  if (screen === 'desktops') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <Text style={styles.title}>Choose a desktop</Text>
        <Text style={styles.hint}>
          Pair each Mac from Settings → Remote. The name you save there is the name in this list.
        </Text>
        <ScrollView style={styles.transcript}>
          {ordered.map((desktop) => (
            <View key={desktop.sessionToken} style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => choose(desktop)}>
                <Text style={styles.rowTitle}>{desktop.deviceLabel}</Text>
                <Text style={styles.status}>{statusLabel(desktop)}</Text>
              </Pressable>
              <Pressable onPress={() => forget(desktop.deviceId)}>
                <Text style={styles.forget}>Forget</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={() => { setError(null); setScreen('pair'); }}>
          <Text style={styles.buttonText}>Pair another Mac</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (screen === 'pair') {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        {desktops.length > 0 ? (
          <Pressable onPress={showDesktops}>
            <Text style={styles.link}>Desktops</Text>
          </Pressable>
        ) : null}
        <Text style={styles.title}>Pair a Mac</Text>
        <Text style={styles.hint}>
          On the Mac, open Sideboard → Settings → Remote, name it, then show a pairing code.
        </Text>
        <TextInput
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="CODE"
          placeholderTextColor="#8b939c"
          value={code}
          onChangeText={setCode}
        />
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          value={url}
          onChangeText={setUrl}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={styles.button}
          onPress={() => {
            const next = code.trim().toUpperCase();
            if (!next) return;
            setError(null);
            pendingTokenRef.current = null;
            link.send({ type: 'pair', code: next });
          }}
        >
          <Text style={styles.buttonText}>Pair</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={showDesktops}>
          <Text style={styles.link}>Desktops</Text>
        </Pressable>
        <Text style={styles.title}>{active?.deviceLabel || 'Sideboard'}</Text>
      </View>
      <ScrollView style={styles.transcript} contentContainerStyle={{ paddingBottom: 12 }}>
        {transcript.bubbles.map((bubble) => (
          <View
            key={bubble.id}
            style={[styles.bubble, bubble.role === 'user' ? styles.user : styles.agent]}
          >
            <Text style={styles.bubbleText}>{bubble.text}</Text>
          </View>
        ))}
        {transcript.working ? <Text style={styles.hint}>Working…</Text> : null}
        {transcript.questions?.map((question) => (
          <View key={question.question} style={styles.ask}>
            <Text style={styles.bubbleText}>{question.question}</Text>
            {question.options.map((option) => (
              <Pressable key={option.label} style={styles.option} onPress={() => sendText(option.label)}>
                <Text style={styles.buttonText}>{option.label}</Text>
                {option.description ? <Text style={styles.hint}>{option.description}</Text> : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, styles.composerInput]}
          placeholder="Message the orchestrator"
          placeholderTextColor="#8b939c"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => sendText(draft)}
        />
        <Pressable style={styles.button} onPress={() => sendText(draft)}>
          <Text style={styles.buttonText}>Send</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#121417', padding: 16 },
  header: { marginBottom: 8 },
  title: { color: '#f4f1ea', fontSize: 22, fontWeight: '600', marginBottom: 8 },
  hint: { color: '#b3bcc4', marginBottom: 8 },
  error: { color: '#ffb4a8', marginBottom: 8 },
  link: { color: '#e8ff47', fontWeight: '600', marginBottom: 8 },
  forget: { color: '#e8ff47', fontWeight: '600' },
  status: { color: '#b3bcc4', marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: '#3a4149',
    borderRadius: 8,
    color: '#f4f1ea',
    padding: 12,
    marginBottom: 10,
  },
  button: {
    backgroundColor: '#e8ff47',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#121417', fontWeight: '600' },
  transcript: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a4149',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: '#f4f1ea', fontSize: 18, fontWeight: '600' },
  bubble: { borderRadius: 10, padding: 12, marginBottom: 8, maxWidth: '90%' },
  user: { alignSelf: 'flex-end', backgroundColor: '#2a3138' },
  agent: { alignSelf: 'flex-start', backgroundColor: '#1c2228' },
  bubbleText: { color: '#f4f1ea' },
  ask: { marginTop: 8, marginBottom: 12 },
  option: {
    backgroundColor: '#e8ff47',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  composerInput: { flex: 1, marginBottom: 0 },
});
