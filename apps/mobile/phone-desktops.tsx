import { Alert, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Brand } from './phone-chrome';
import { desktopStatus } from './labels';
import { styles } from './styles';

type ListedDesktop = {
  deviceId: string;
  deviceLabel: string;
  sessionToken: string;
  online: boolean | null;
  expired: boolean;
};

export function PhoneDesktopsScreen<T extends ListedDesktop>({
  desktops,
  error,
  onChoose,
  onForget,
  onPair,
}: {
  desktops: T[];
  error: string | null;
  onChoose: (desktop: T) => void;
  onForget: (deviceId: string) => void;
  onPair: () => void;
}) {
  function confirmForget(desktop: T) {
    Alert.alert(
      `Forget “${desktop.deviceLabel}”?`,
      'This phone removes the saved pairing. Pair again from Settings → Remote on that Mac.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: () => onForget(desktop.deviceId) },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Brand />
        <Text style={styles.title}>Choose a desktop</Text>
        <Text style={styles.hint}>
          Pair each Mac from Settings → Remote. The name you save there is the name in this list.
        </Text>
      </View>
      <ScrollView style={styles.transcript} contentContainerStyle={styles.listPad}>
        {desktops.map((desktop) => (
          <View key={desktop.sessionToken} style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => onChoose(desktop)}>
              <Text style={styles.rowTitle}>{desktop.deviceLabel}</Text>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.dot,
                    desktop.online ? styles.dotOn : desktop.expired ? styles.dotWarn : styles.dotOff,
                  ]}
                />
                <Text style={styles.status}>{desktopStatus(desktop)}</Text>
              </View>
            </Pressable>
            <Pressable
              style={styles.ghost}
              accessibilityRole="button"
              accessibilityLabel={`Forget ${desktop.deviceLabel}`}
              onPress={() => confirmForget(desktop)}
            >
              <Text style={styles.ghostText}>Forget</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.footer}>
        <Pressable style={styles.primary} onPress={onPair}>
          <Text style={styles.primaryText}>Pair another Mac</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
