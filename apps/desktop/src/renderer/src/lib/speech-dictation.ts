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

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
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
  let offset = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
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
    return 'Microphone access is blocked. Allow it in System Settings → Privacy.';
  }
  if (code === 'audio-capture' || code === 'no-speech' || code === 'NotFoundError') {
    return 'No microphone input. Hold the mic and speak, then release.';
  }
  if (code === 'network') {
    return 'Dictation needs a network connection.';
  }
  return 'Could not start dictation.';
}
