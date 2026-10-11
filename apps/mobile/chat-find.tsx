import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { palette, styles } from './styles';

type SelectionRef = { current: string };

/** Read-only field with the whole message selected, so Copy uses the system text menu. */
export function MessageTextTool({ text, selectionRef }: { text: string; selectionRef: SelectionRef }) {
  const [selection, setSelection] = useState({ start: 0, end: text.length });
  useEffect(() => {
    selectionRef.current = text;
    setSelection({ start: 0, end: text.length });
  }, [text, selectionRef]);
  return (
    <TextInput
      editable={false}
      multiline
      scrollEnabled={false}
      value={text}
      selection={selection}
      onSelectionChange={(event) => {
        const next = event.nativeEvent.selection;
        setSelection(next);
        selectionRef.current = text.slice(next.start, next.end);
      }}
      style={styles.messageSelect}
      autoFocus
      showSoftInputOnFocus={false}
      accessibilityLabel="Selected message text"
    />
  );
}

export function ChatFindBar({
  query,
  index,
  total,
  onQuery,
  onNext,
  onPrev,
  onClose,
}: {
  query: string;
  index: number;
  total: number;
  onQuery: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const label = query.trim() ? (total ? `${index + 1} / ${total}` : 'No matches') : '';
  return (
    <View style={styles.findBar}>
      <TextInput
        value={query}
        onChangeText={onQuery}
        placeholder="Find in chat"
        placeholderTextColor={palette.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        style={styles.findInput}
        accessibilityLabel="Find in chat"
        returnKeyType="search"
        onSubmitEditing={onNext}
      />
      <Text style={styles.findCount} accessibilityLiveRegion="polite">
        {label}
      </Text>
      <Pressable
        accessibilityLabel="Previous match"
        disabled={!total}
        onPress={onPrev}
        style={styles.findNav}
        hitSlop={6}
      >
        <Text style={[styles.findNavText, !total && styles.findNavOff]}>↑</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Next match"
        disabled={!total}
        onPress={onNext}
        style={styles.findNav}
        hitSlop={6}
      >
        <Text style={[styles.findNavText, !total && styles.findNavOff]}>↓</Text>
      </Pressable>
      <Pressable accessibilityLabel="Close find" onPress={onClose} style={styles.findNav} hitSlop={6}>
        <Text style={styles.findNavText}>×</Text>
      </Pressable>
    </View>
  );
}

/** Same chat text actions as the desktop context menu: Select All and Search Chat. */
export function showMessageTools(actions: { onSelectAll: () => void; onSearch: () => void }): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Select All', 'Search Chat', 'Cancel'], cancelButtonIndex: 2 },
      (index) => {
        if (index === 0) actions.onSelectAll();
        if (index === 1) actions.onSearch();
      },
    );
    return;
  }
  Alert.alert('Message', undefined, [
    { text: 'Select All', onPress: actions.onSelectAll },
    { text: 'Search Chat', onPress: actions.onSearch },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
