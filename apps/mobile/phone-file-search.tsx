import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PhonePaneId, PhoneSide } from './phone-pane-types';
import { palette } from './styles';

/** Path filter for All files. The Mac searches the worktree; this only collects the text. */
export function PhoneFileSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextInput
      style={styles.search}
      value={value}
      onChangeText={onChange}
      autoCapitalize="none"
      autoCorrect={false}
      clearButtonMode="while-editing"
      placeholder="Filter files…"
      placeholderTextColor={palette.muted}
      accessibilityLabel="Filter files"
      returnKeyType="search"
    />
  );
}

export function PhonePaneBody({
  side,
  fileQuery,
  onFileQuery,
  onOpenPath,
}: {
  side: PhoneSide | null;
  fileQuery: string;
  onFileQuery: (value: string) => void;
  onOpenPath: (path: string) => void;
}) {
  const files = side?.pane === 'files';
  const ready = side && !(side.loading && side.rows.length === 0) ? side : null;
  return (
    <View style={styles.fill}>
      {files ? <PhoneFileSearch value={fileQuery} onChange={onFileQuery} /> : null}
      {ready ? (
        <ScrollView style={styles.fill} contentContainerStyle={styles.list}>
          {ready.note ? <Text style={styles.note}>{ready.note}</Text> : null}
          {ready.rows.length === 0 && !ready.note ? (
            <Text style={styles.note}>{files && fileQuery.trim() ? 'No matching files.' : 'Nothing here.'}</Text>
          ) : null}
          {ready.rows.map((row) => (
            <Pressable
              key={`${row.label}:${row.detail ?? ''}`}
              onPress={() => {
                if (row.path) onOpenPath(row.path);
                else if (row.href) void Linking.openURL(row.href);
              }}
            >
              <View style={styles.row}>
                <Text style={styles.label} numberOfLines={1}>
                  {row.label}
                </Text>
                {row.detail ? <RowDetail pane={ready.pane} detail={row.detail} /> : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={styles.note}>Loading…</Text>
      )}
    </View>
  );
}

/** Changes rows arrive as `+12 −3`. Color them like the desktop git badge. */
function RowDetail({ pane, detail }: { pane: PhonePaneId; detail: string }) {
  const counts = pane === 'changes' ? parseChangeCounts(detail) : null;
  if (!counts) return <Text style={styles.detail}>{detail}</Text>;
  return (
    <Text style={styles.detail}>
      <Text style={styles.add}>+{counts.add}</Text>
      <Text> </Text>
      <Text style={styles.del}>−{counts.del}</Text>
    </Text>
  );
}

/** `+12 −3` from the Mac. The minus may be U+2212 or a hyphen. */
function parseChangeCounts(detail: string): { add: number; del: number } | null {
  const match = /^\+(\d+)\s+[−-](\d+)$/.exec(detail.trim());
  if (!match) return null;
  return { add: Number(match[1]), del: Number(match[2]) };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingVertical: 8 },
  note: { color: palette.muted, fontSize: 14, paddingHorizontal: 16, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  label: { flex: 1, color: palette.text, fontSize: 14 },
  detail: { color: palette.muted, fontSize: 12 },
  add: { color: '#6a9955' },
  del: { color: '#f14c4c' },
  search: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 6,
    color: palette.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
