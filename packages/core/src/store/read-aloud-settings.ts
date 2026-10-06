/** Web Speech API `utterance.rate` for chat Read Aloud. */
export const READ_ALOUD_RATE_MIN = 0.5;
export const READ_ALOUD_RATE_MAX = 3;
export const READ_ALOUD_RATE_DEFAULT = 1;

export function clampReadAloudRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return READ_ALOUD_RATE_DEFAULT;
  return Math.min(
    READ_ALOUD_RATE_MAX,
    Math.max(READ_ALOUD_RATE_MIN, Math.round(value * 10) / 10),
  );
}

export function sanitizeReadAloudVoiceURI(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const uri = value.trim().slice(0, 400);
  return uri || undefined;
}

export type ReadAloudSettingsFields = {
  readAloudRate?: number;
  readAloudVoiceURI?: string;
};

export function copyReadAloudFromUnknown(
  source: Record<string, unknown>,
  out: ReadAloudSettingsFields,
): void {
  if (typeof source.readAloudRate === 'number' && Number.isFinite(source.readAloudRate)) {
    out.readAloudRate = clampReadAloudRate(source.readAloudRate);
  }
  const voiceURI = sanitizeReadAloudVoiceURI(source.readAloudVoiceURI);
  if (voiceURI) out.readAloudVoiceURI = voiceURI;
}

export function patchReadAloudSettings(
  patch: { readAloudRate?: number; readAloudVoiceURI?: string | null },
  advanced: ReadAloudSettingsFields,
): void {
  if (typeof patch.readAloudRate === 'number' && Number.isFinite(patch.readAloudRate)) {
    advanced.readAloudRate = clampReadAloudRate(patch.readAloudRate);
  }
  if (patch.readAloudVoiceURI === null || patch.readAloudVoiceURI === '') {
    delete advanced.readAloudVoiceURI;
  } else if (typeof patch.readAloudVoiceURI === 'string') {
    const voiceURI = sanitizeReadAloudVoiceURI(patch.readAloudVoiceURI);
    if (voiceURI) advanced.readAloudVoiceURI = voiceURI;
    else delete advanced.readAloudVoiceURI;
  }
}
