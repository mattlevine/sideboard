import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { codeRefRangeLabel } from './phone-code-ref';
import {
  diffIndexSelection,
  parseUnifiedPatch,
  tapDiffRow,
  type DiffRowSelection,
  type PhoneDiffRow,
} from './phone-diff';
import { palette } from './styles';

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

type LineRange = { startLine: number; endLine: number; text: string };

/**
 * Added lines green, removed lines red, same as the desktop diff.
 * When `onAdd` is set, tap a line and then another to select a range.
 */
export function PhoneDiffView({ patch, onAdd }: { patch: string; onAdd?: (range: LineRange) => void }) {
  const rows = parseUnifiedPatch(patch);
  const [picked, setPicked] = useState<DiffRowSelection | null>(null);
  useEffect(() => {
    setPicked(null);
  }, [patch]);
  const range = picked && onAdd ? diffIndexSelection(rows, picked.anchor, picked.focus) : null;
  if (rows.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>(binary or empty patch)</Text>
      </View>
    );
  }
  const lo = picked ? Math.min(picked.anchor, picked.focus) : -1;
  const hi = picked ? Math.max(picked.anchor, picked.focus) : -1;
  const label = range ? `Add to chat ${codeRefRangeLabel(range.startLine, range.endLine)}` : 'Add to chat';
  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill} nestedScrollEnabled>
        <ScrollView horizontal nestedScrollEnabled contentContainerStyle={styles.pad}>
          <View>
            {rows.map((row, index) => (
              <DiffLine
                key={`${row.kind}:${row.lineNo}:${index}`}
                row={row}
                selected={index >= lo && index <= hi}
                onPress={
                  onAdd
                    ? () => {
                        setPicked((current) => tapDiffRow(current, index));
                      }
                    : undefined
                }
              />
            ))}
          </View>
        </ScrollView>
      </ScrollView>
      {onAdd ? (
        <View style={styles.bar}>
          <Text style={styles.hint}>{range ? 'Selected lines' : 'Tap a line, then another'}</Text>
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
      ) : null}
    </View>
  );
}

function DiffLine({
  row,
  selected,
  onPress,
}: {
  row: PhoneDiffRow;
  selected: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      <View style={[styles.gutter, row.kind === 'add' && styles.gutterAdd, row.kind === 'del' && styles.gutterDel]} />
      <Text style={styles.no}>{row.lineNo}</Text>
      <Text style={styles.code}>{row.text.length ? row.text : ' '}</Text>
      {selected ? <View pointerEvents="none" style={styles.pick} /> : null}
    </>
  );
  const lineStyle = [styles.line, row.kind === 'add' && styles.add, row.kind === 'del' && styles.del];
  if (!onPress) return <View style={lineStyle}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Line ${row.lineNo}`}
      style={lineStyle}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { paddingBottom: 32 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: palette.muted, fontSize: 14 },
  line: { flexDirection: 'row', alignItems: 'stretch', minHeight: 20 },
  add: { backgroundColor: 'rgba(60, 140, 70, 0.18)' },
  del: { backgroundColor: 'rgba(180, 60, 50, 0.18)' },
  gutter: { width: 4, backgroundColor: 'transparent' },
  gutterAdd: { backgroundColor: '#4a9a58' },
  gutterDel: { backgroundColor: '#a05048' },
  pick: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(61, 143, 212, 0.28)' },
  no: {
    width: 40,
    color: palette.muted,
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'right',
    fontFamily: mono,
    paddingRight: 8,
  },
  code: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: mono,
    paddingRight: 12,
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
});
