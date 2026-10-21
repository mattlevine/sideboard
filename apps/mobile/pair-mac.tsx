import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Brand } from './phone-chrome';
import { PairScan } from './pair-scan';
import { palette, styles } from './styles';

export function PairMacScreen({
  hasDesktops,
  onDesktops,
  code,
  onChangeCode,
  relayUrl,
  onChangeRelay,
  error,
  onSubmit,
  onPasteInvalid,
  onClearError,
}: {
  hasDesktops: boolean;
  onDesktops: () => void;
  code: string;
  onChangeCode: (value: string) => void;
  relayUrl: string;
  onChangeRelay: (value: string) => void;
  error: string | null;
  /** Return true when the line is valid and pairing has started. */
  onSubmit: (raw: string) => boolean;
  onPasteInvalid: () => void;
  onClearError: () => void;
}) {
  const [scanning, setScanning] = useState(false);

  if (scanning) {
    return (
      <View style={styles.screen}>
        <StatusBar style="light" />
        <PairScan
          onCode={(data) => {
            const ok = onSubmit(data);
            if (ok) setScanning(false);
            return ok;
          }}
          onClose={() => setScanning(false)}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.header}>
          {hasDesktops ? (
            <Pressable onPress={onDesktops}>
              <Text style={styles.link}>Desktops</Text>
            </Pressable>
          ) : (
            <Brand />
          )}
          <Text style={styles.title}>Pair a Mac</Text>
          <Text style={styles.hint}>
            Scan the QR code from Settings → Remote on the Mac, or paste the pairing line.
          </Text>
        </View>
        <View style={styles.form}>
          <Pressable
            style={styles.primary}
            onPress={() => {
              onClearError();
              setScanning(true);
            }}
          >
            <Text style={styles.primaryText}>Scan QR code</Text>
          </Pressable>
          <Text style={styles.label}>Pairing line</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="sb1…"
            placeholderTextColor={palette.muted}
            value={code}
            onChangeText={onChangeCode}
          />
          <Text style={styles.label}>Relay</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            value={relayUrl}
            onChangeText={onChangeRelay}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.primary, !code.trim() && styles.primaryDisabled]}
            onPress={() => {
              if (!onSubmit(code)) onPasteInvalid();
            }}
          >
            <Text style={styles.primaryText}>Pair</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
