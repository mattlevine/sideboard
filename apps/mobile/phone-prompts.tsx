import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MarkdownText } from './markdown';
import { palette, styles } from './styles';

type AskOption = { label: string; description?: string };
type AskQuestion = { question: string; options: AskOption[] };

export type PhonePermission = {
  id: string;
  title: string;
  detail: string;
  path?: string;
  allowSession: boolean;
  defaultToNo?: boolean;
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
  onDecide: (id: string, decision: 'allow' | 'deny' | 'allow_session') => void;
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
          <Text style={styles.optionLabel}>Allow for this session</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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
