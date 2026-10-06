import { join } from 'node:path';

export function speechDictateSourcePaths(root: string): {
  swift: string;
  plist: string;
} {
  return {
    swift: join(root, 'speech-dictate.swift'),
    plist: join(root, 'speech-dictate-Info.plist'),
  };
}

export function mapSpeechDictateError(stderr: string): string {
  const msg = stderr.trim().split('\n').pop() ?? stderr.trim();
  if (/not-authorized/i.test(msg)) {
    return 'Speech recognition is blocked. Allow Sideboard Dictation in System Settings → Privacy & Security → Speech Recognition.';
  }
  if (/timeout/i.test(msg)) {
    return 'Dictation timed out. Try a shorter phrase.';
  }
  if (/unavailable/i.test(msg)) {
    return 'macOS dictation is unavailable for this language.';
  }
  if (/ENOENT|swiftc/i.test(msg)) {
    return 'Could not build the dictation helper. Install Xcode command-line tools.';
  }
  return msg || 'Could not transcribe dictation.';
}
