export function composeDictationPrompt(base: string, spoken: string): string {
  const next = spoken.replace(/\s+/g, ' ').trim();
  if (!next) return base;
  if (!base.trim()) return next;
  return /\s$/.test(base) ? `${base}${next}` : `${base} ${next}`;
}

export function speechEventTranscript(
  results: ArrayLike<{ 0?: { transcript?: string } }>,
): string {
  let out = '';
  for (let i = 0; i < results.length; i++) {
    out += results[i]?.[0]?.transcript ?? '';
  }
  return out;
}

export function speechRecognitionSupported(
  win: {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  } | null = typeof window === 'undefined' ? null : window,
): boolean {
  if (!win) return false;
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionHandle;

export type SpeechRecognitionHandle = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
  onstart: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export function speechRecognitionCtor(
  win: {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  } | null = typeof window === 'undefined' ? null : (window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }),
): SpeechRecognitionCtor | null {
  if (!win) return null;
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function dictationErrorMessage(code: string | undefined): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'Microphone access is blocked. Allow it in System Settings → Privacy.';
  }
  if (code === 'audio-capture' || code === 'no-speech') {
    return 'No microphone input. Check that a mic is connected.';
  }
  if (code === 'network') {
    return 'Dictation needs a network connection.';
  }
  return 'Could not start dictation.';
}
