import { join } from 'node:path';

export const SPEECH_DICTATE_BUNDLE_ID = 'ai.sideboard.dictation';

export function speechDictateSourcePaths(root: string): {
  swift: string;
  plist: string;
} {
  return {
    swift: join(root, 'speech-dictate.swift'),
    plist: join(root, 'speech-dictate-Info.plist'),
  };
}

export function speechDictateOpenArgs(opts: {
  appRoot: string;
  wavPath: string;
  locale: string;
  stdoutPath: string;
  stderrPath: string;
}): string[] {
  return [
    '-W',
    '-n',
    '-g',
    '-j',
    '-a',
    opts.appRoot,
    '--stdout',
    opts.stdoutPath,
    '--stderr',
    opts.stderrPath,
    '--args',
    opts.wavPath,
    opts.locale,
  ];
}

export function isNoSpeechDictateStderr(stderr: string): boolean {
  return /no speech/i.test(stderr);
}

export function mapSpeechDictateError(stderr: string): string {
  const text = stderr.trim();
  const msg = text.split('\n').pop() ?? text;
  if (/not-authorized|missing-usage-description|SIGABRT|usage description/i.test(text)) {
    return 'Speech recognition is blocked. Allow Sideboard Dictation in System Settings → Privacy & Security → Speech Recognition.';
  }
  if (isNoSpeechDictateStderr(text)) {
    return 'Click the mic, speak, then click it again to stop.';
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
  if (/Command failed:.*speech-dictate/i.test(text)) {
    return 'Speech recognition is blocked. Allow Sideboard Dictation in System Settings → Privacy & Security → Speech Recognition.';
  }
  return msg || 'Could not transcribe dictation.';
}
