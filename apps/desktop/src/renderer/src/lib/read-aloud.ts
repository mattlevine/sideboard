/** Runtime copies of core clamps — keep Node app-settings out of the renderer bundle. */

export const READ_ALOUD_RATE_MIN = 0.5;
export const READ_ALOUD_RATE_MAX = 3;
export const READ_ALOUD_RATE_DEFAULT = 1;
export const READ_ALOUD_RATE_STEP = 0.1;

export function clampReadAloudRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return READ_ALOUD_RATE_DEFAULT;
  return Math.min(
    READ_ALOUD_RATE_MAX,
    Math.max(READ_ALOUD_RATE_MIN, Math.round(value * 10) / 10),
  );
}

export function sanitizeReadAloudVoiceURI(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 400);
}

export function formatReadAloudRate(rate: number): string {
  const n = clampReadAloudRate(rate);
  return `${n % 1 === 0 ? String(n) : n.toFixed(1)}×`;
}

export function remainingSpeechText(text: string, charIndex: number): string {
  if (!Number.isFinite(charIndex) || charIndex <= 0) return text;
  const i = Math.min(text.length, Math.max(0, Math.floor(charIndex)));
  return text.slice(i);
}

export function splitSpokenText(
  text: string,
  charIndex: number,
): { spoken: string; rest: string } {
  if (!Number.isFinite(charIndex) || charIndex <= 0) return { spoken: '', rest: text };
  const i = Math.min(text.length, Math.max(0, Math.floor(charIndex)));
  return { spoken: text.slice(0, i), rest: text.slice(i) };
}

export type SpeechVoiceInfo = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

export function speechVoicesFromEngine(
  voices: ReadonlyArray<{
    voiceURI: string;
    name: string;
    lang: string;
    localService: boolean;
    default: boolean;
  }>,
): SpeechVoiceInfo[] {
  return voices.map((v) => ({
    voiceURI: v.voiceURI,
    name: v.name,
    lang: v.lang || 'und',
    localService: Boolean(v.localService),
    default: Boolean(v.default),
  }));
}

export function speechVoiceLangLabel(lang: string, locale = 'en'): string {
  const tag = lang.replace(/_/g, '-');
  try {
    const parsed = new Intl.Locale(tag);
    const languageNames = new Intl.DisplayNames([locale], { type: 'language' });
    const language = languageNames.of(parsed.language) ?? parsed.language;
    if (!parsed.region) return language;
    const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
    const region = regionNames.of(parsed.region) ?? parsed.region;
    return `${language} (${region})`;
  } catch {
    return tag;
  }
}

export type SpeechVoiceGroup = {
  lang: string;
  label: string;
  voices: SpeechVoiceInfo[];
};

function langRank(lang: string, preferred?: string): number {
  const tag = lang.toLowerCase().replace(/_/g, '-');
  const pref = (preferred ?? '').toLowerCase().replace(/_/g, '-');
  if (pref && tag === pref) return 0;
  const prefLang = pref.split('-')[0];
  if (prefLang && tag === prefLang) return 1;
  if (prefLang && tag.startsWith(`${prefLang}-`)) return 1;
  if (tag === 'en' || tag.startsWith('en-')) return 2;
  return 3;
}

export function groupSpeechVoices(
  voices: SpeechVoiceInfo[],
  locale?: string,
): SpeechVoiceGroup[] {
  const byLang = new Map<string, SpeechVoiceInfo[]>();
  for (const voice of voices) {
    const lang = voice.lang || 'und';
    const list = byLang.get(lang);
    if (list) list.push(voice);
    else byLang.set(lang, [voice]);
  }
  const groups: SpeechVoiceGroup[] = [];
  for (const [lang, list] of byLang) {
    list.sort((a, b) => {
      if (a.default !== b.default) return a.default ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    groups.push({
      lang,
      label: speechVoiceLangLabel(lang, locale),
      voices: list,
    });
  }
  groups.sort((a, b) => {
    const rank = langRank(a.lang, locale) - langRank(b.lang, locale);
    if (rank !== 0) return rank;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

export function pickSpeechVoice(
  voices: SpeechVoiceInfo[],
  preferredURI?: string,
): SpeechVoiceInfo | undefined {
  const wanted = sanitizeReadAloudVoiceURI(preferredURI);
  if (wanted) {
    const match = voices.find((v) => v.voiceURI === wanted);
    if (match) return match;
  }
  return voices.find((v) => v.default) ?? voices.find((v) => v.lang.startsWith('en')) ?? voices[0];
}

export function nudgeReadAloudRate(rate: number, direction: -1 | 1): number {
  return clampReadAloudRate(clampReadAloudRate(rate) + direction * READ_ALOUD_RATE_STEP);
}
