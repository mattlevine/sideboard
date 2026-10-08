import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
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
    mediaTypes: ['images'],
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
    mediaTypes: ['images'],
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
    const file = new File(asset.uri);
    if (file.exists && file.size > MAX_BYTES) throw new Error(`${asset.name || 'File'} is larger than 8 MB.`);
    const dataBase64 = await file.base64();
    const name = asset.name || 'file';
    assertSize(name, dataBase64);
    out.push({ name, dataBase64 });
  }
  return out;
}

/** 16 kHz mono PCM WAV. The Mac transcribes this exact layout. */
const WAV: RecordingOptions = {
  isMeteringEnabled: false,
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  android: {
    extension: '.wav',
    outputFormat: 'default',
    audioEncoder: 'default',
    sampleRate: 16000,
  },
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.MAX,
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/wav',
    bitsPerSecond: 256000,
  },
};

export async function startMic(): Promise<AudioRecorder> {
  const perm = await requestRecordingPermissionsAsync();
  if (!perm.granted) throw new Error('Microphone access is off.');
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  const recording = new AudioModule.AudioRecorder(WAV);
  await recording.prepareToRecordAsync();
  recording.record();
  return recording;
}

export async function stopMic(recording: AudioRecorder): Promise<string> {
  await recording.stop();
  await setAudioModeAsync({ allowsRecording: false });
  const uri = recording.uri;
  if (!uri) throw new Error('No recording.');
  return new File(uri).base64();
}
