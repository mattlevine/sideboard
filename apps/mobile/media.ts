import { Audio } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

const MAX_BYTES = 8 * 1024 * 1024;

export type PickedFile = {
  name: string;
  dataBase64: string;
  previewUri?: string;
};

function assertSize(name: string, dataBase64: string): void {
  if (dataBase64.length > Math.ceil((MAX_BYTES * 4) / 3)) {
    throw new Error(`${name} is larger than 8 MB.`);
  }
}

async function imageAssets(assets: ImagePicker.ImagePickerAsset[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const asset of assets) {
    if (!asset.base64) throw new Error('Could not read that photo.');
    const name = asset.fileName || `photo-${Date.now()}.jpg`;
    assertSize(name, asset.base64);
    out.push({ name, dataBase64: asset.base64, previewUri: asset.uri });
  }
  return out;
}

export async function takePhoto(): Promise<PickedFile[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera access is off.');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
    base64: true,
  });
  if (result.canceled) return [];
  return imageAssets(result.assets);
}

export async function pickPhotos(): Promise<PickedFile[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library access is off.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
    base64: true,
    allowsMultipleSelection: true,
  });
  if (result.canceled) return [];
  return imageAssets(result.assets);
}

export async function pickDocuments(): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (result.canceled) return [];
  const out: PickedFile[] = [];
  for (const asset of result.assets) {
    const info = await FileSystem.getInfoAsync(asset.uri);
    const size = info.exists && 'size' in info ? info.size ?? 0 : 0;
    if (size > MAX_BYTES) throw new Error(`${asset.name || 'File'} is larger than 8 MB.`);
    const dataBase64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const name = asset.name || 'file';
    assertSize(name, dataBase64);
    out.push({ name, dataBase64 });
  }
  return out;
}

const WAV: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
  },
  ios: {
    extension: '.wav',
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.MAX,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/wav',
    bitsPerSecond: 256000,
  },
};

export async function startMic(): Promise<Audio.Recording> {
  const perm = await Audio.requestPermissionsAsync();
  if (!perm.granted) throw new Error('Microphone access is off.');
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(WAV);
  await recording.startAsync();
  return recording;
}

export async function stopMic(recording: Audio.Recording): Promise<string> {
  await recording.stopAndUnloadAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  const uri = recording.getURI();
  if (!uri) throw new Error('No recording.');
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}
