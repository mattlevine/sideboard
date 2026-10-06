/** ~1s of 16 kHz PCM chunks while the live helper starts (4096 @ 48 kHz → ~12). */
export const LIVE_PCM_QUEUE_MAX = 12;

export function enqueueLivePcm(
  queue: string[],
  chunk: string,
  max = LIVE_PCM_QUEUE_MAX,
): string[] {
  queue.push(chunk);
  if (queue.length > max) queue.splice(0, queue.length - max);
  return queue;
}

export function composeDictationPrompt(base: string, spoken: string): string {
  const next = spoken.replace(/\s+/g, ' ').trim();
  if (!next) return base;
  if (!base.trim()) return next;
  return /\s$/.test(base) ? `${base}${next}` : `${base} ${next}`;
}

export function dictationCaptureSupported(
  nav: { mediaDevices?: { getUserMedia?: unknown } } | null = typeof navigator === 'undefined'
    ? null
    : navigator,
): boolean {
  return typeof nav?.mediaDevices?.getUserMedia === 'function';
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export const DICTATION_TARGET_RATE = 16_000;
export const DICTATION_MIN_SECONDS = 0.45;
export const DICTATION_MIN_RMS = 0.004;

export function downsampleMono(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!fromRate || !toRate || fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const n = Math.max(0, Math.round(samples.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const t = src - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i1] ?? 0;
    out[i] = a + (b - a) * t;
  }
  return out;
}

export function sampleRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export function prepareDictationWav(
  samples: Float32Array,
  sampleRate: number,
): { wav: ArrayBuffer; rms: number; seconds: number } {
  const down = downsampleMono(samples, sampleRate, DICTATION_TARGET_RATE);
  return {
    wav: encodeWavPcm16(down, DICTATION_TARGET_RATE),
    rms: sampleRms(down),
    seconds: down.length / DICTATION_TARGET_RATE,
  };
}

export function float32ToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const pcm = float32ToPcm16(samples);
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  new Uint8Array(buffer, 44).set(pcm);
  return buffer;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function dictationErrorMessage(code: string | undefined): string {
  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'NotAllowedError') {
    return 'Microphone access is blocked. Allow it in System Settings → Privacy & Security → Microphone.';
  }
  if (code === 'silent') {
    return 'The microphone captured silence. Allow it in System Settings → Privacy & Security → Microphone.';
  }
  if (
    code === 'audio-capture' ||
    code === 'no-speech' ||
    code === 'too-short' ||
    code === 'NotFoundError'
  ) {
    return 'Click the mic, speak, then click it again to stop.';
  }
  if (code === 'network') {
    return 'Dictation needs a network connection.';
  }
  return 'Could not start dictation.';
}

const PERMISSION_ERROR_RE =
  /microphone access|captured silence|speech recognition is blocked|no microphone|privacy & security|notallowederror|not-allowed/i;

/** Errors that should open a dialog, not a line under the composer. */
export function isDictationPermissionError(message: string | null | undefined): boolean {
  return Boolean(message && PERMISSION_ERROR_RE.test(message));
}

export function dictationPrivacySettingsUrl(message: string | null | undefined): string {
  if (message && /speech recognition/i.test(message)) {
    return 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_SpeechRecognition';
  }
  return 'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone';
}

/** Names macOS Privacy actually lists (Dev Electron vs packaged Sideboard.app). */
export function dictationTccNames(packaged: boolean): { microphoneApp: string; speechApp: string } {
  return {
    microphoneApp: packaged ? 'Sideboard' : 'Electron',
    speechApp: 'Sideboard Dictation',
  };
}

export function dictationPermissionDialogCopy(
  error: string,
  packaged: boolean,
): { title: string; message: string } {
  const { microphoneApp, speechApp } = dictationTccNames(packaged);
  const speech = /speech recognition/i.test(error);
  const devNote = packaged
    ? ''
    : 'This Dev window is not listed as Sideboard. macOS uses Electron’s identity until you install Sideboard.app.\n\n';
  if (speech) {
    return {
      title: 'Allow speech recognition',
      message:
        `${devNote}System Settings → Privacy & Security → Speech Recognition → enable ${speechApp}.\n\n` +
        `It appears after the first mic click. Microphone access is listed separately as ${microphoneApp}.`,
    };
  }
  return {
    title: 'Allow microphone',
    message:
      `${devNote}System Settings → Privacy & Security → Microphone → enable ${microphoneApp}.\n\n` +
      `Dictation also needs Speech Recognition → ${speechApp}.`,
  };
}
