import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { highlightCode } from './code-highlight';
import { splitFileHighlight } from './code-language';
import {
  codeRefChipLabel,
  codeRefRangeLabel,
  keepOpenCursor,
  openCursorSelection,
  PHONE_CODE_LINE_HEIGHT,
  scrollOffsetForLine,
  selectionLineRange,
  type PhoneCodeRef,
} from './phone-code-ref';
import { palette } from './styles';

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

type LineRange = { startLine: number; endLine: number; text: string };
type Caret = { start: number; end: number };

/**
 * Selection handles on highlighted code. The caret opens on the cited line,
 * or on the first character. Keystrokes are ignored; the Mac file stays the source.
 */
export function usePinnedSelection(
  content: string,
  startLine: number | undefined,
  endLine: number | undefined,
  pick: (start: number, end: number) => LineRange | null,
) {
  const pinned = useMemo(
    () => openCursorSelection(content, startLine, endLine),
    [content, startLine, endLine],
  );
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const hold = useRef(true);
  const revealed = useRef('');
  const didMount = useRef(false);
  const revealRef = useRef<() => void>(() => {});
  const token = `${startLine ?? ''}:${endLine ?? ''}:${content.length}`;
  const [selection, setSelection] = useState<Caret | null>(pinned);
  const [range, setRange] = useState<LineRange | null>(() => pick(pinned.start, pinned.end));

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    hold.current = true;
    revealed.current = '';
    setSelection(pinned);
    setRange(pickRef.current(pinned.start, pinned.end));
    const id = requestAnimationFrame(() => revealRef.current());
    return () => cancelAnimationFrame(id);
  }, [pinned, token]);

  const onSelectionChange = (start: number, end: number) => {
    if (keepOpenCursor(hold.current, start, end, content.length, pinned)) {
      if (start !== pinned.start || end !== pinned.end) {
        inputRef.current?.setNativeProps({ selection: pinned });
      }
      return;
    }
    hold.current = false;
    setSelection(null);
    setRange(pickRef.current(start, end));
  };

  const reveal = () => {
    if (revealed.current === token || !inputRef.current) return;
    revealed.current = token;
    const y = scrollOffsetForLine(startLine, PHONE_CODE_LINE_HEIGHT);
    const pin = () => {
      if (!hold.current) return;
      scrollRef.current?.scrollTo({ y, animated: false });
      inputRef.current?.setNativeProps({ selection: pinned });
    };
    pin();
    inputRef.current.focus();
    requestAnimationFrame(pin);
  };
  revealRef.current = reveal;

  return { inputRef, scrollRef, selection, range, onSelectionChange, reveal };
}

export function PhoneFileSelect({
  content,
  onAdd,
  rangeFor,
  startLine,
  endLine,
  language = '',
}: {
  content: string;
  onAdd: (range: LineRange) => void;
  /** Diffs map the selection onto file line numbers. Files use the text as-is. */
  rangeFor?: (start: number, end: number) => LineRange | null;
  /** Open with this file range already selected, the way a desktop citation does. */
  startLine?: number;
  endLine?: number;
  language?: string;
}) {
  const pick = (start: number, end: number) =>
    rangeFor ? rangeFor(start, end) : selectionLineRange(content, start, end);
  const cursor = usePinnedSelection(content, startLine, endLine, pick);
  const painted = useMemo(() => paintFile(content, language), [content, language]);
  const [height, setHeight] = useState(0);
  const label = cursor.range ? `Add to chat ${codeRefRangeLabel(cursor.range.startLine, cursor.range.endLine)}` : 'Add to chat';
  return (
    <View style={styles.fill}>
      <ScrollView
        ref={cursor.scrollRef}
        style={styles.fill}
        contentContainerStyle={styles.pad}
        onContentSizeChange={cursor.reveal}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text
            pointerEvents="none"
            accessible={false}
            style={styles.code}
            onLayout={(event) => {
              const next = Math.ceil(event.nativeEvent.layout.height);
              if (next > 0) setHeight((prev) => (prev === next ? prev : next));
            }}
          >
            {painted}
          </Text>
          {height > 0 ? (
            <CodeInput
              inputRef={cursor.inputRef}
              content={content}
              height={height}
              selection={cursor.selection}
              onSelectionChange={cursor.onSelectionChange}
              onLayout={cursor.reveal}
              accessibilityLabel="File text"
              style={styles.overlay}
            />
          ) : null}
        </View>
      </ScrollView>
      <View style={styles.bar}>
        <Text style={styles.hint}>{cursor.range ? 'Selected lines' : 'Drag to select lines'}</Text>
        <Pressable
          disabled={!cursor.range}
          onPress={() => {
            if (cursor.range) onAdd(cursor.range);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add reference to chat"
          style={[styles.add, !cursor.range && styles.addOff]}
        >
          <Text style={styles.addText}>{label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Transparent field over highlighted text so the caret and selection stay visible. */
export function CodeInput({
  inputRef,
  content,
  height,
  selection,
  onSelectionChange,
  onLayout,
  accessibilityLabel,
  style,
}: {
  inputRef: RefObject<TextInput | null>;
  content: string;
  height: number;
  selection: Caret | null;
  onSelectionChange: (start: number, end: number) => void;
  onLayout: () => void;
  accessibilityLabel: string;
  style?: object;
}) {
  return (
    <TextInput
      ref={inputRef}
      editable
      multiline
      scrollEnabled={false}
      value={content}
      onChangeText={() => inputRef.current?.setNativeProps({ text: content })}
      onSelectionChange={(event) => {
        const next = event.nativeEvent.selection;
        onSelectionChange(next.start, next.end);
      }}
      onLayout={onLayout}
      {...(selection ? { selection } : {})}
      inputMode="none"
      showSoftInputOnFocus={false}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      textAlignVertical="top"
      cursorColor="#3d8fd4"
      selectionColor="rgba(61, 143, 212, 0.45)"
      style={[styles.code, styles.input, style, { height }]}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

function paintFile(content: string, language: string): ReactNode {
  if (!content) return ' ';
  const { head, rest } = splitFileHighlight(content);
  const painted = highlightCode(head, language, 'file');
  return rest ? [painted, rest] : painted;
}

/** Composer chips for file selections. Tap to remove one. */
export function PhoneCodeRefChips({
  refs,
  onRemove,
}: {
  refs: PhoneCodeRef[];
  onRemove: (id: string) => void;
}) {
  if (refs.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {refs.map((ref) => (
        <Pressable key={ref.id} style={styles.chip} onPress={() => onRemove(ref.id)}>
          <Text style={styles.chipText} numberOfLines={1}>
            {codeRefChipLabel(ref)}
          </Text>
          <Text style={styles.chipX}>×</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: 16, paddingBottom: 32 },
  code: {
    color: palette.text,
    fontSize: 13,
    lineHeight: PHONE_CODE_LINE_HEIGHT,
    fontFamily: mono,
  },
  input: {
    color: 'transparent',
    padding: 0,
    margin: 0,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  bar: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  hint: { flex: 1, color: palette.muted, fontSize: 13 },
  add: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addOff: { opacity: 0.35 },
  addText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  row: { gap: 8, paddingBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: 220,
  },
  chipText: { color: palette.secondary, fontSize: 12, flexShrink: 1 },
  chipX: { color: palette.muted, fontSize: 16 },
});
