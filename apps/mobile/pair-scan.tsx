import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import type { BarcodeSettings } from 'expo-camera';
import { palette } from './styles';

type CameraModule = typeof import('expo-camera');

const QR_SETTINGS: BarcodeSettings = { barcodeTypes: ['qr'] };

/**
 * In-app scan of the pairing QR from Settings → Remote.
 * The camera module loads only on this screen, so paste still works if this
 * install does not include it yet.
 */
export function PairScan({
  onCode,
  onClose,
}: {
  /** Return true when the payload is a pairing line and pairing has started. */
  onCode: (data: string) => boolean;
  onClose: () => void;
}) {
  const [camera, setCamera] = useState<CameraModule | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import('expo-camera')
      .then((mod) => {
        if (!cancelled) setCamera(mod);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (missing) {
    return (
      <SafeAreaView style={styles.fill}>
        <View style={styles.permission}>
          <Text style={styles.title}>Camera</Text>
          <Text style={styles.hint}>
            This install can’t scan yet. Paste the pairing line, or update the Sideboard phone app.
          </Text>
          <Pressable style={styles.primary} onPress={onClose}>
            <Text style={styles.primaryText}>Paste instead</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!camera) {
    return (
      <View style={styles.fill}>
        <Text style={styles.hint}>Opening the camera…</Text>
      </View>
    );
  }

  return <PairScanCamera camera={camera} onCode={onCode} onClose={onClose} />;
}

function PairScanCamera({
  camera,
  onCode,
  onClose,
}: {
  camera: CameraModule;
  onCode: (data: string) => boolean;
  onClose: () => void;
}) {
  const [permission, requestPermission] = camera.useCameraPermissions();
  const [rejected, setRejected] = useState(false);
  const locked = useRef(false);
  const { CameraView } = camera;

  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (locked.current) return;
      locked.current = true;
      if (onCode(data)) return;
      setRejected(true);
    },
    [onCode],
  );

  if (!permission) {
    return (
      <View style={styles.fill}>
        <Text style={styles.hint}>Opening the camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    const canAsk = permission.canAskAgain;
    return (
      <SafeAreaView style={styles.fill}>
        <View style={styles.permission}>
          <Text style={styles.title}>Camera</Text>
          <Text style={styles.hint}>
            Sideboard needs the camera to scan the pairing code on the Mac.
          </Text>
          <Pressable
            style={styles.primary}
            onPress={() => {
              if (canAsk) void requestPermission();
              else void Linking.openSettings();
            }}
          >
            <Text style={styles.primaryText}>{canAsk ? 'Allow camera' : 'Open Settings'}</Text>
          </Pressable>
          <Pressable onPress={onClose}>
            <Text style={styles.link}>Paste instead</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={QR_SETTINGS}
        onBarcodeScanned={rejected ? undefined : onBarcodeScanned}
      />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <Pressable style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <View style={styles.frame} pointerEvents="none">
          <View style={styles.reticle} />
        </View>
        <Text style={styles.caption}>
          {rejected
            ? 'That QR code is not a Sideboard pairing code.'
            : 'Point at the QR code in Settings → Remote.'}
        </Text>
        {rejected ? (
          <Pressable
            style={styles.retry}
            onPress={() => {
              locked.current = false;
              setRejected(false);
            }}
          >
            <Text style={styles.primaryText}>Scan again</Text>
          </Pressable>
        ) : (
          <View style={styles.retrySpacer} />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  overlay: { flex: 1 },
  cancel: { paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start' },
  cancelText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  frame: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 16,
  },
  caption: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 28,
  },
  retry: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    backgroundColor: palette.accentDim,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  retrySpacer: { height: 16 },
  permission: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  title: { color: palette.text, fontSize: 22, fontWeight: '600' },
  hint: { color: palette.muted, fontSize: 15, lineHeight: 21, paddingHorizontal: 24 },
  primary: {
    marginTop: 8,
    backgroundColor: palette.accentDim,
    borderWidth: 1,
    borderColor: palette.accent,
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: palette.text, fontSize: 15, fontWeight: '600' },
  link: { color: palette.accent, fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
