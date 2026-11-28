import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { AgentKindIcon, agentKindLabel } from './agent-icons';
import { agentStatus } from './labels';
import {
  PhoneListNeedsYou,
  type PhoneListAsk,
  type PhoneListPlan,
  type PhonePermission,
  type PhonePermissionDecision,
} from './phone-prompts';
import { palette, styles } from './styles';

export type PhoneChat = {
  id: string;
  title: string;
  status: string;
  preview: string;
  updatedAt: string;
  agent?: string;
  acpHarness?: 'gemini' | 'copilot';
  prUrl?: string;
  prNumber?: string;
  prStatus?: string;
  needsYou?: boolean;
  blockedReason?: string;
  ask?: PhoneListAsk;
  permission?: PhonePermission | null;
  plan?: PhoneListPlan;
};

export type PhonePrBadgeId = 'new' | 'draft' | 'pending' | 'review' | 'approved' | 'merged';

export type PhonePrBadge = {
  id: PhonePrBadgeId;
  label: string;
  title: string;
  /** Red dot: merge conflicts, failing checks, or changes requested. */
  conflict?: boolean;
};

const PHONE_PR_BADGE_IDS = new Set<PhonePrBadgeId>([
  'new',
  'draft',
  'pending',
  'review',
  'approved',
  'merged',
]);

export type PhoneHistoryChat = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  where: string;
  agent: string;
  acpHarness?: 'gemini' | 'copilot';
  workspace?: string;
};

/** Same mark as the desktop sidebar: outline cube over a blue offset plate. */
export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'md' }) {
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

export function Brand() {
  return (
    <View style={styles.brand}>
      <BrandMark size="md" />
      <Text style={styles.brandName}>Sideboard</Text>
    </View>
  );
}

/** Desktop live row: spinning mark, shimmer verb, and the three dots. */
export function StreamStatus({ verb }: { verb: string }) {
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

function canAnswerInline(chat: PhoneChat): boolean {
  if (chat.permission?.id) return true;
  if (chat.plan?.text) return true;
  return Boolean(chat.ask?.questions.some((question) => question.options.length > 0));
}

export function ChatRow({
  chat,
  onOpen,
  onArchive,
  onAnswer,
  onDecide,
}: {
  chat: PhoneChat;
  onOpen: () => void;
  onArchive: () => void;
  onAnswer?: (chatId: string, text: string, opts?: { planMode: false }) => void;
  onDecide?: (chatId: string, id: string, decision: PhonePermissionDecision) => void;
}) {
  const needsYou = Boolean(chat.needsYou && chat.blockedReason);
  const [held, setHeld] = useState<PhoneChat | null>(null);
  const answering = useRef(false);
  const view = held ?? chat;
  const inline = canAnswerInline(view) && Boolean(onAnswer && onDecide) && (needsYou || held != null);
  const askKey = chat.ask?.questions.map((question) => question.question).join('\n') ?? '';
  useEffect(() => {
    if (!held) return;
    if (chat.needsYou && canAnswerInline(chat)) setHeld(null);
  }, [held, chat.needsYou, chat.blockedReason, chat.permission?.id, chat.plan?.text, askKey]);
  useEffect(() => {
    if (!held) {
      answering.current = false;
      return;
    }
    const timer = setTimeout(() => setHeld(null), 700);
    return () => clearTimeout(timer);
  }, [held]);
  const main = (
    <Pressable style={styles.rowMain} onPress={onOpen}>
      <View style={styles.titleRow}>
        <AgentKindIcon agent={chat.agent || ''} acpHarness={chat.acpHarness} />
        <Text style={[styles.rowTitle, styles.titleFlex]} numberOfLines={1}>{chat.title}</Text>
      </View>
      <Text style={[styles.preview, needsYou ? styles.previewNeed : null]} numberOfLines={2}>
        {needsYou ? chat.blockedReason : chat.preview || 'No messages yet'}
      </Text>
      <View style={styles.statusRow}>
        <View
          style={[
            styles.dot,
            needsYou
              ? styles.dotWarn
              : chat.status === 'running' || chat.status === 'queued'
                ? styles.dotRun
                : chat.status === 'error' || chat.status === 'broken'
                  ? styles.dotErr
                  : styles.dotOff,
          ]}
        />
        <Text style={styles.status}>{needsYou ? 'Needs you' : agentStatus(chat.status)}</Text>
      </View>
    </Pressable>
  );
  const archive = (
    <Pressable
      style={styles.ghost}
      onPress={onArchive}
      accessibilityRole="button"
      accessibilityLabel={`Archive ${chat.title}. It stays in History.`}
    >
      <Text style={styles.ghostText}>Archive</Text>
    </Pressable>
  );
  if (!inline || !onAnswer || !onDecide) {
    return (
      <View style={styles.row}>
        {main}
        {archive}
      </View>
    );
  }
  return (
    <View style={[styles.row, rowStyle.stack]}>
      <View style={rowStyle.top}>
        {main}
        {archive}
      </View>
      <PhoneListNeedsYou
        chat={view}
        busy={held != null}
        onAnswer={(chatId, text, opts) => {
          if (answering.current) return;
          answering.current = true;
          setHeld(chat);
          onAnswer(chatId, text, opts);
        }}
        onDecide={(chatId, id, decision) => {
          if (answering.current) return;
          answering.current = true;
          setHeld(chat);
          onDecide(chatId, id, decision);
        }}
      />
    </View>
  );
}

const rowStyle = StyleSheet.create({
  stack: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
    borderLeftWidth: 3,
    borderLeftColor: palette.warn,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

export function HistoryRow({
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
          <AgentKindIcon agent={chat.agent} acpHarness={chat.acpHarness} />
          <Text style={[styles.rowTitle, styles.titleFlex]} numberOfLines={1}>{chat.title}</Text>
          {chat.workspace ? (
            <View style={styles.historyWorkspace} accessibilityLabel={`Workspace ${chat.workspace}`}>
              <Text style={styles.historyWorkspaceText} numberOfLines={1}>
                {chat.workspace}
              </Text>
            </View>
          ) : null}
        </View>
        {chat.preview ? (
          <Text style={styles.preview} numberOfLines={1}>
            {chat.preview}
          </Text>
        ) : null}
        <Text style={styles.status}>
          {chat.where} · {agentKindLabel(chat.agent, chat.acpHarness)}
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

export function TagChip({
  tag,
  selected,
  filtering,
  remove,
  onPress,
}: {
  tag: string;
  selected: boolean;
  filtering: boolean;
  remove?: boolean;
  onPress: () => void;
}) {
  const label = remove
    ? `Clear tag ${tag}`
    : selected
      ? `Stop filtering by ${tag}`
      : filtering
        ? `Also require ${tag}`
        : `Show workspaces tagged ${tag}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[styles.tag, (selected || remove) && styles.tagSelected]}
    >
      <Text style={[styles.tagText, (selected || remove) && styles.tagTextSelected]}>{tag}</Text>
      {remove ? <Text style={styles.tagRemove}>×</Text> : null}
    </Pressable>
  );
}

const PR_BADGE_TONE: Record<PhonePrBadgeId, { box: ViewStyle; text: TextStyle }> = {
  new: { box: styles.prBadgeNew, text: styles.prBadgeTextNew },
  draft: { box: styles.prBadgeDraft, text: styles.prBadgeTextDraft },
  pending: { box: styles.prBadgePending, text: styles.prBadgeTextPending },
  review: { box: styles.prBadgeReview, text: styles.prBadgeTextReview },
  approved: { box: styles.prBadgeApproved, text: styles.prBadgeTextApproved },
  merged: { box: styles.prBadgeMerged, text: styles.prBadgeTextMerged },
};

export function phonePrBadge(value: unknown): PhonePrBadge | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const badge = value as { id?: unknown; label?: unknown; title?: unknown };
  if (typeof badge.id !== 'string' || !PHONE_PR_BADGE_IDS.has(badge.id as PhonePrBadgeId)) {
    return undefined;
  }
  const id = badge.id as PhonePrBadgeId;
  const label = typeof badge.label === 'string' && badge.label.trim() ? badge.label.trim() : id;
  const title = typeof badge.title === 'string' && badge.title.trim() ? badge.title.trim() : label;
  const conflict = (value as { conflict?: unknown }).conflict === true;
  return {
    id,
    label,
    title,
    ...(conflict ? { conflict } : {}),
  };
}

export function PrBadge({ badge }: { badge: PhonePrBadge }) {
  const tone = PR_BADGE_TONE[badge.id];
  return (
    <View style={[styles.prBadge, tone.box]} accessibilityLabel={badge.title}>
      <Text style={[styles.prBadgeText, tone.text]}>{badge.label}</Text>
      {badge.conflict ? <View style={styles.prBadgeConflictDot} /> : null}
    </View>
  );
}

export function AddButton({
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
