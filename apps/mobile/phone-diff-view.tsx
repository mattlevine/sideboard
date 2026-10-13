import { useMemo, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { highlightCode } from './code-highlight';
import { codeRefRangeLabel, PHONE_CODE_LINE_HEIGHT } from './phone-code-ref';
import { diffVisibleBody, diffVisibleSelection, parseUnifiedPatch, type PhoneDiffRow } from './phone-diff';
import { CodeInput, usePinnedSelection } from './phone-file-select';
import { palette } from './styles';

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const CODE_LEFT = 44;
const DIFF_HIGHLIGHT_LINES = 500;

type LineRange = { startLine: number; endLine: number; text: string };
type PaintedRow = PhoneDiffRow & { textNode: ReactNode };

/**
 * Added lines green, removed lines red, with the file's syntax colors.
 * The code column is a text field so the diff can be selected.
 */
export function PhoneDiffView({
  patch,
  language = '',
  onAdd,
}: {
  patch: string;
  language?: string;
  onAdd?: (range: LineRange) => void;
}) {
  const rows = useMemo(() => parseUnifiedPatch(patch), [patch]);
  const body = useMemo(() => diffVisibleBody(rows), [rows]);
  const painted = useMemo(() => paintDiffRows(rows, language), [rows, language]);
  const codeWidth = useMemo(() => codeColumnWidth(rows), [rows]);
  const cursor = usePinnedSelection(body, undefined, undefined, (start, end) =>
    diffVisibleSelection(rows, start, end),
  );
  if (rows.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>(binary or empty patch)</Text>
      </View>
    );
  }
  const range = onAdd ? cursor.range : null;
  const label = range ? `Add to chat ${codeRefRangeLabel(range.startLine, range.endLine)}` : 'Add to chat';
  const height = rows.length * PHONE_CODE_LINE_HEIGHT;
  return (
    <View style={styles.fill}>
      <ScrollView
        ref={cursor.scrollRef}
        style={styles.fill}
        onContentSizeChange={cursor.reveal}
        keyboardShouldPersistTaps="handled"
      >
        <ScrollView horizontal nestedScrollEnabled>
          <View style={{ width: CODE_LEFT + codeWidth, height }}>
            <View pointerEvents="none">
              {painted.map((row, index) => (
                <DiffLine key={`${row.kind}:${row.lineNo}:${index}`} row={row} />
              ))}
            </View>
            <CodeInput
              inputRef={cursor.inputRef}
              content={body}
              height={height}
              selection={cursor.selection}
              onSelectionChange={cursor.onSelectionChange}
              onLayout={cursor.reveal}
              accessibilityLabel="Diff text"
              style={[styles.field, { width: codeWidth }]}
            />
          </View>
        </ScrollView>
      </ScrollView>
      {onAdd ? (
        <View style={styles.bar}>
          <Text style={styles.hint}>{range ? 'Selected lines' : 'Drag to select lines'}</Text>
          <Pressable
            disabled={!range}
            onPress={() => {
              if (range) onAdd(range);
            }}
            accessibilityRole="button"
            accessibilityLabel="Add reference to chat"
            style={[styles.addBtn, !range && styles.addBtnOff]}
          >
            <Text style={styles.addBtnText}>{label}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function paintDiffRows(rows: PhoneDiffRow[], language: string): PaintedRow[] {
  return rows.map((row, index) => ({
    ...row,
    textNode:
      index < DIFF_HIGHLIGHT_LINES && row.text.length
        ? highlightCode(row.text, language, `d${index}`)
        : row.text || ' ',
  }));
}

function codeColumnWidth(rows: PhoneDiffRow[]): number {
  let longest = 1;
  for (const row of rows) {
    if (row.text.length > longest) longest = row.text.length;
  }
  return longest * 9 + 32;
}

function DiffLine({ row }: { row: PaintedRow }) {
  return (
    <View style={[styles.line, row.kind === 'add' && styles.add, row.kind === 'del' && styles.del]}>
      <View style={[styles.gutter, row.kind === 'add' && styles.gutterAdd, row.kind === 'del' && styles.gutterDel]} />
      <Text style={styles.no}>{row.lineNo}</Text>
      <Text style={styles.code}>{row.textNode}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: palette.muted, fontSize: 14 },
  line: { flexDirection: 'row', alignItems: 'stretch', height: PHONE_CODE_LINE_HEIGHT },
  add: { backgroundColor: 'rgba(60, 140, 70, 0.18)' },
  del: { backgroundColor: 'rgba(180, 60, 50, 0.18)' },
  gutter: { width: 4, backgroundColor: 'transparent' },
  gutterAdd: { backgroundColor: '#4a9a58' },
  gutterDel: { backgroundColor: '#a05048' },
  no: {
    width: 40,
    color: palette.muted,
    fontSize: 12,
    lineHeight: PHONE_CODE_LINE_HEIGHT,
    textAlign: 'right',
    fontFamily: mono,
    paddingRight: 8,
  },
  code: {
    color: palette.text,
    fontSize: 13,
    lineHeight: PHONE_CODE_LINE_HEIGHT,
    fontFamily: mono,
    paddingRight: 12,
  },
  field: {
    position: 'absolute',
    left: CODE_LEFT,
    top: 0,
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
  addBtn: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addBtnOff: { opacity: 0.35 },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
