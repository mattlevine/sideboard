import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PhoneChangeScopeMenu } from './phone-change-scope';
import { changeBadge } from './phone-diff';
import { emptyChangesNote, type PhoneChangeScope, type PhonePaneId, type PhoneSide } from './phone-pane-types';
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
  changeScope,
  commitSha,
  onFileQuery,
  onChangeScope,
  onOpenPath,
}: {
  side: PhoneSide | null;
  fileQuery: string;
  changeScope: PhoneChangeScope;
  commitSha: string | null;
  onFileQuery: (value: string) => void;
  onChangeScope: (scope: PhoneChangeScope, commitSha: string | null) => void;
  onOpenPath: (path: string) => void;
}) {
  const files = side?.pane === 'files';
  const changes = side?.pane === 'changes';
  const ready = side && !(side.loading && side.rows.length === 0) ? side : null;
  const empty = changes ? emptyChangesNote(changeScope, commitSha, side?.base) : 'Nothing here.';
  return (
    <View style={styles.fill}>
      {files ? <PhoneFileSearch value={fileQuery} onChange={onFileQuery} /> : null}
      {changes ? (
        <PhoneChangeScopeMenu side={side} scope={changeScope} commitSha={commitSha} onPick={onChangeScope} />
      ) : null}
      {ready ? (
        <ScrollView style={styles.fill} contentContainerStyle={styles.list}>
          {ready.note ? <Text style={styles.note}>{ready.note}</Text> : null}
          {ready.rows.length === 0 && !ready.note ? (
            <Text style={styles.note}>{files && fileQuery.trim() ? 'No matching files.' : empty}</Text>
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
                {row.detail || (ready.pane === 'changes' && row.status) ? (
                  <RowDetail pane={ready.pane} detail={row.detail} status={row.status} />
                ) : null}
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

/** Changes rows use the desktop badge: status letter, then only non-zero counts. */
function RowDetail({ pane, detail, status }: { pane: PhonePaneId; detail?: string; status?: string }) {
  if (pane !== 'changes') return <Text style={styles.detail}>{detail}</Text>;
  const badge = changeBadge(status, detail);
  if (!badge) return detail ? <Text style={styles.detail}>{detail}</Text> : null;
  return (
    <Text style={styles.badge}>
      {badge.letter ? <Text style={{ color: badge.letterColor, fontWeight: '700' }}>{badge.letter}</Text> : null}
      {badge.add != null ? (
        <Text style={styles.add}>{`${badge.letter ? ' ' : ''}+${badge.add}`}</Text>
      ) : null}
      {badge.del != null ? (
        <Text style={styles.del}>{`${badge.letter || badge.add != null ? ' ' : ''}-${badge.del}`}</Text>
      ) : null}
    </Text>
  );
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
  badge: {
    color: palette.muted,
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
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
