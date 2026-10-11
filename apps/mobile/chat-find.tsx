import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { palette, styles } from './styles';

type SelectionRef = { current: string };

/**
 * One message as a plain field so iOS can show selection handles.
 * A multiline input inside the transcript scroll view reports its own content
 * height and stretches the chat with empty space, so the field is taken out of
 * layout and sized from a matching Text. It stays editable only so the system
 * selection gesture runs; keystrokes are written back to the original message.
 */
export function MessageTextTool({ text, selectionRef }: { text: string; selectionRef: SelectionRef }) {
  const inputRef = useRef<TextInput>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    selectionRef.current = text;
  }, [text, selectionRef]);
  return (
    <View>
      <Text
        pointerEvents="none"
        accessible={false}
        style={[styles.messageSelect, styles.messageSelectMeasure]}
        onLayout={(event) => {
          const next = Math.ceil(event.nativeEvent.layout.height);
          if (next > 0) setHeight((prev) => (prev === next ? prev : next));
        }}
      >
        {text || ' '}
      </Text>
      {height > 0 ? (
        <TextInput
          ref={inputRef}
          editable
          multiline
          scrollEnabled={false}
          value={text}
          onChangeText={() => inputRef.current?.setNativeProps({ text })}
          onSelectionChange={(event) => {
            const next = event.nativeEvent.selection;
            selectionRef.current = text.slice(next.start, next.end);
          }}
          inputMode="none"
          selectTextOnFocus
          autoFocus
          selectionColor="rgba(61, 143, 212, 0.45)"
          style={[styles.messageSelect, styles.messageSelectField, { height }]}
          accessibilityLabel="Selected message text"
        />
      ) : null}
    </View>
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
