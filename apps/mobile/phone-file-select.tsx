import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  codeRefChipLabel,
  codeRefRangeLabel,
  holdsCitedSelection,
  lineStartOffset,
  selectionLineRange,
  type PhoneCodeRef,
} from './phone-code-ref';
import { palette } from './styles';

/**
 * Plain field so iOS can show selection handles on a file.
 * Keystrokes are ignored; the Mac file stays the source.
 */
type LineRange = { startLine: number; endLine: number; text: string };

export function PhoneFileSelect({
  content,
  onAdd,
  rangeFor,
  startLine,
  endLine,
}: {
  content: string;
  onAdd: (range: LineRange) => void;
  /** Diffs map the selection onto file line numbers. Files use the text as-is. */
  rangeFor?: (start: number, end: number) => LineRange | null;
  /** Open with this file range already selected, the way a desktop citation does. */
  startLine?: number;
  endLine?: number;
}) {
  const inputRef = useRef<TextInput>(null);
  const cited =
    startLine != null
      ? {
          start: lineStartOffset(content, startLine),
          end: lineStartOffset(content, (endLine ?? startLine) + 1),
        }
      : null;
  const citedSelection = cited && cited.end > cited.start ? cited : null;
  const holdCitation = useRef(citedSelection != null);
  const restoredCitation = useRef(false);
  const pick = (start: number, end: number) =>
    rangeFor ? rangeFor(start, end) : selectionLineRange(content, start, end);
  const [selection, setSelection] = useState(citedSelection);
  const [range, setRange] = useState<LineRange | null>(() => (selection ? pick(selection.start, selection.end) : null));
  const label = range ? `Add to chat ${codeRefRangeLabel(range.startLine, range.endLine)}` : 'Add to chat';
  return (
    <View style={styles.fill}>
      <TextInput
        ref={inputRef}
        editable
        multiline
        scrollEnabled
        value={content}
        onChangeText={() => inputRef.current?.setNativeProps({ text: content })}
        onSelectionChange={(event) => {
          const next = event.nativeEvent.selection;
          if (holdsCitedSelection(holdCitation.current, next.start, next.end)) {
            if (!restoredCitation.current && citedSelection) {
              restoredCitation.current = true;
              inputRef.current?.setNativeProps({ selection: citedSelection });
            }
            return;
          }
          holdCitation.current = false;
          if (citedSelection) setSelection(next.start === next.end ? null : next);
          setRange(pick(next.start, next.end));
        }}
        {...(selection ? { selection } : {})}
        inputMode="none"
        showSoftInputOnFocus={false}
        autoFocus
        selectionColor="rgba(61, 143, 212, 0.45)"
        style={styles.field}
        accessibilityLabel="File text"
      />
      <View style={styles.bar}>
        <Text style={styles.hint}>{range ? 'Selected lines' : 'Drag to select lines'}</Text>
        <Pressable
          disabled={!range}
          onPress={() => {
            if (range) onAdd(range);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add reference to chat"
          style={[styles.add, !range && styles.addOff]}
        >
          <Text style={styles.addText}>{label}</Text>
        </Pressable>
      </View>
    </View>
  );
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
  field: {
    flex: 1,
    color: palette.text,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    padding: 16,
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
