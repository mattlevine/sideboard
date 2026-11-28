import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MarkdownText } from './markdown';
import { palette, styles } from './styles';

type AskOption = { label: string; description?: string };
type AskQuestion = { question: string; options: AskOption[] };

export type PhonePermissionDecision = 'allow' | 'deny' | 'allow_session';

export type PhonePermission = {
  id: string;
  title: string;
  detail: string;
  path?: string;
  allowSession: boolean;
  sessionLabel?: string;
  defaultToNo?: boolean;
};

export type PhoneListAsk = {
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
  }>;
};

export type PhoneListPlan = { text: string };

/** Open PR waiting on this person's review. Same row the Needs you list shows beside a blocked chat. */
export type PhoneReviewPr = {
  repoPath: string;
  repoName: string;
  number: number;
  title: string;
  url: string;
  /** Set when a workspace for this pull request is already checked out. */
  chatId?: string;
};

export type PhoneListAnswer = {
  id: string;
  blockedReason?: string;
  ask?: PhoneListAsk;
  permission?: PhonePermission | null;
  plan?: PhoneListPlan;
};

export function PhoneAsks({
  questions,
  chatId,
  onChatLink,
  onPick,
}: {
  questions: AskQuestion[] | null;
  chatId: string;
  onChatLink: (id: string) => void;
  onPick: (label: string) => void;
}) {
  if (!questions?.length) return null;
  return (
    <>
      {questions.map((question) => (
        <View key={question.question} style={styles.ask}>
          <MarkdownText text={question.question} tone="ask" chatId={chatId} onChatLink={onChatLink} />
          {question.options.map((option, index) => (
            <Pressable key={option.label} style={styles.option} onPress={() => onPick(option.label)}>
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
    </>
  );
}

/** Same Allow / Deny the desktop composer shows, pinned under every phone tab. */
export function PhonePermissionBar({
  prompt,
  onDecide,
}: {
  prompt: PhonePermission | null;
  onDecide: (id: string, decision: PhonePermissionDecision) => void;
}) {
  if (!prompt) return null;
  const deny = (
    <Pressable key="deny" style={styles.option} onPress={() => onDecide(prompt.id, 'deny')}>
      <Text style={styles.optionLabel}>Deny</Text>
    </Pressable>
  );
  const allow = (
    <Pressable key="allow" style={styles.option} onPress={() => onDecide(prompt.id, 'allow')}>
      <Text style={styles.optionLabel}>Allow</Text>
    </Pressable>
  );
  const denyFirst = prompt.defaultToNo === true;
  return (
    <View style={bar.wrap}>
      <Text style={styles.askText}>Permission</Text>
      <Text style={styles.optionLabel}>{prompt.title}</Text>
      {prompt.detail ? <Text style={styles.optionDesc}>{prompt.detail}</Text> : null}
      {prompt.path ? <Text style={styles.optionDesc}>{prompt.path}</Text> : null}
      {denyFirst ? deny : allow}
      {denyFirst ? allow : deny}
      {prompt.allowSession ? (
        <Pressable style={styles.option} onPress={() => onDecide(prompt.id, 'allow_session')}>
          <Text style={styles.optionLabel}>{prompt.sessionLabel || 'Allow for this session'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function shownText(reason: string | undefined, value: string | undefined): string {
  const text = value?.trim() ?? '';
  if (!text) return '';
  if (reason?.includes(text)) return '';
  return text;
}

/**
 * Choices on a Needs you row. A tap answers that chat and does not open it.
 * Ask picks send the option label, the same prompt PhoneAsks sends.
 * Approve sends the plan text and the caller turns plan mode off.
 * Allow / Deny uses the same decision PhonePermissionBar sends.
 */
export function PhoneListNeedsYou({
  chat,
  busy = false,
  onAnswer,
  onDecide,
}: {
  chat: PhoneListAnswer;
  busy?: boolean;
  onAnswer: (chatId: string, text: string, opts?: { planMode: false }) => void;
  onDecide: (chatId: string, id: string, decision: PhonePermissionDecision) => void;
}) {
  const reason = chat.blockedReason;
  let body: ReactNode = null;
  if (chat.permission?.id) {
    const prompt = chat.permission;
    const denyFirst = prompt.defaultToNo === true;
    const deny = (
      <Pressable
        key="deny"
        style={list.decision}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Deny"
        onPress={() => onDecide(chat.id, prompt.id, 'deny')}
      >
        <Text style={[styles.optionLabel, denyFirst ? null : list.denyText]}>Deny</Text>
      </Pressable>
    );
    const allow = (
      <Pressable
        key="allow"
        style={[list.decision, denyFirst ? null : list.allow]}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Allow"
        onPress={() => onDecide(chat.id, prompt.id, 'allow')}
      >
        <Text style={styles.optionLabel}>Allow</Text>
      </Pressable>
    );
    const detail = shownText(reason, prompt.detail);
    const path = shownText(reason, prompt.path);
    body = (
      <>
        {detail ? (
          <Text style={styles.optionDesc} numberOfLines={3}>
            {detail}
          </Text>
        ) : null}
        {path ? (
          <Text style={styles.optionDesc} numberOfLines={1}>
            {path}
          </Text>
        ) : null}
        <View style={list.decisions}>
          {denyFirst ? deny : allow}
          {denyFirst ? allow : deny}
        </View>
        {prompt.allowSession ? (
          <Pressable
            style={list.choice}
            disabled={busy}
            accessibilityRole="button"
            onPress={() => onDecide(chat.id, prompt.id, 'allow_session')}
          >
            <Text style={styles.optionLabel}>{prompt.sessionLabel || 'Allow for this session'}</Text>
          </Pressable>
        ) : null}
      </>
    );
  } else if (chat.plan?.text) {
    body = (
      <Pressable
        style={list.allow}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Approve plan"
        onPress={() => onAnswer(chat.id, chat.plan!.text, { planMode: false })}
      >
        <Text style={[styles.optionLabel, list.allowLabel]}>Approve</Text>
      </Pressable>
    );
  } else if (chat.ask?.questions.some((question) => question.options.length > 0)) {
    body = (
      <>
        {chat.ask.questions.map((question) => {
          const text = shownText(reason, question.question);
          return (
            <View key={question.question} style={list.questionBlock}>
              {question.header ? <Text style={list.header}>{question.header}</Text> : null}
              {text ? (
                <Text style={list.question} numberOfLines={4}>
                  {text}
                </Text>
              ) : null}
              {question.options.map((option) => (
                <Pressable
                  key={option.label}
                  style={({ pressed }) => [list.choice, pressed && !busy ? list.pressed : null]}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityHint={option.description}
                  onPress={() => onAnswer(chat.id, option.label)}
                >
                  <Text style={styles.optionLabel}>{option.label}</Text>
                  {option.description ? (
                    <Text style={styles.optionDesc} numberOfLines={2}>
                      {option.description}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          );
        })}
      </>
    );
  }
  if (!body) return null;
  return (
    <View
      style={[list.actions, busy ? list.busy : null]}
      pointerEvents={busy ? 'none' : 'auto'}
      accessibilityLabel="Answer without opening the chat"
    >
      {body}
    </View>
  );
}

/** A review-requested pull request on the Needs you list. A tap opens or creates that workspace. */
export function PhoneReviewPrRow({
  pr,
  busy = false,
  onOpen,
}: {
  pr: PhoneReviewPr;
  busy?: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && !busy ? review.pressed : null,
        busy ? review.busy : null,
      ]}
      disabled={busy}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${pr.repoName} pull request ${pr.number}, ${pr.title}. Opens the workspace.`}
      accessibilityState={{ disabled: busy }}
    >
      <View style={styles.rowMain}>
        <View style={styles.titleRow}>
          <Text style={[styles.rowTitle, styles.titleFlex]} numberOfLines={1}>
            {pr.title}
          </Text>
          <View style={[styles.prBadge, styles.prBadgeReview, review.badge]}>
            <Text style={[styles.prBadgeText, styles.prBadgeTextReview]}>{`#${pr.number}`}</Text>
          </View>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {pr.repoName}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, styles.dotWarn]} />
          <Text style={styles.status}>{busy ? 'Opening…' : 'Review requested'}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const review = StyleSheet.create({
  pressed: { backgroundColor: palette.hover },
  busy: { opacity: 0.55 },
  badge: { flexShrink: 0 },
});

const bar = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.bg,
  },
});

const list = StyleSheet.create({
  actions: { gap: 8, marginTop: 2 },
  busy: { opacity: 0.55 },
  questionBlock: { gap: 6 },
  header: {
    color: palette.secondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  question: { color: palette.text, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  choice: {
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  pressed: { backgroundColor: palette.hover },
  decisions: { flexDirection: 'row', gap: 8 },
  decision: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingHorizontal: 12,
  },
  allow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentDim,
    paddingHorizontal: 12,
  },
  allowLabel: { fontWeight: '600' },
  denyText: { color: palette.secondary },
});
