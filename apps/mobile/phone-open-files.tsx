import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { openDocLabel, type PhoneOpenDoc } from './phone-open-docs';
import { palette } from './styles';

/** Open files and artifacts, on their own row under Chat / All files / Changes / Checks. */
export function PhoneOpenFiles({
  docs,
  activeId,
  onSelect,
  onClose,
}: {
  docs: PhoneOpenDoc[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (docs.length === 0) return null;
  return (
    <View style={styles.files}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fileTabs}>
        {docs.map((doc) => {
          const label = openDocLabel(doc.viewer.title);
          const on = doc.id === activeId;
          return (
            <View key={doc.id} style={[styles.fileTab, on && styles.fileOn]}>
              <Pressable
                onPress={() => onSelect(doc.id)}
                accessibilityRole="button"
                accessibilityLabel={doc.viewer.title}
              >
                <Text style={[styles.fileName, on && styles.fileNameOn]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onClose(doc.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Close ${label}`}
              >
                <Text style={styles.fileX}>×</Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  files: {
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.bg,
  },
  fileTabs: { alignItems: 'center', paddingHorizontal: 8 },
  fileTab: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 220,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  fileOn: { borderBottomColor: palette.text },
  fileName: { maxWidth: 160, color: palette.muted, fontSize: 13, fontWeight: '600', paddingVertical: 8 },
  fileNameOn: { color: palette.text },
  fileX: { color: palette.muted, fontSize: 16, paddingHorizontal: 6, paddingVertical: 8 },
});
