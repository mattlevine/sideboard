import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { parseUnifiedPatch } from './phone-diff';
import { palette } from './styles';

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** Added lines green, removed lines red, same as the desktop diff. */
export function PhoneDiffView({ patch }: { patch: string }) {
  const rows = parseUnifiedPatch(patch);
  if (rows.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>(binary or empty patch)</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.fill} nestedScrollEnabled>
      <ScrollView horizontal nestedScrollEnabled contentContainerStyle={styles.pad}>
        <View>
          {rows.map((row, index) => (
            <View
              key={`${row.kind}:${row.lineNo}:${index}`}
              style={[styles.line, row.kind === 'add' && styles.add, row.kind === 'del' && styles.del]}
            >
              <View style={[styles.gutter, row.kind === 'add' && styles.gutterAdd, row.kind === 'del' && styles.gutterDel]} />
              <Text style={styles.no}>{row.lineNo}</Text>
              <Text style={styles.code}>{row.text.length ? row.text : ' '}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
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
});
