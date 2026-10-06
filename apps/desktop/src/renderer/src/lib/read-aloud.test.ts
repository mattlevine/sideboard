import { describe, expect, it } from 'vitest';
import {
  clampReadAloudRate,
  formatReadAloudRate,
  groupSpeechVoices,
  nudgeReadAloudRate,
  pickSpeechVoice,
  remainingSpeechText,
  sanitizeReadAloudVoiceURI,
  speechVoiceLangLabel,
  speechVoicesFromEngine,
  splitSpokenText,
  type SpeechVoiceInfo,
} from './read-aloud';

function voice(partial: Partial<SpeechVoiceInfo> & Pick<SpeechVoiceInfo, 'voiceURI' | 'name'>): SpeechVoiceInfo {
  return {
    lang: 'en-US',
    localService: true,
    default: false,
    ...partial,
  };
}

describe('clampReadAloudRate', () => {
  it('defaults and clamps to 0.5–3 in tenths', () => {
    expect(clampReadAloudRate(undefined)).toBe(1);
    expect(clampReadAloudRate('1')).toBe(1);
    expect(clampReadAloudRate(1.74)).toBe(1.7);
    expect(clampReadAloudRate(0)).toBe(0.5);
    expect(clampReadAloudRate(9)).toBe(3);
  });
});

describe('formatReadAloudRate', () => {
  it('shows whole numbers without a trailing decimal', () => {
    expect(formatReadAloudRate(1)).toBe('1×');
    expect(formatReadAloudRate(1.5)).toBe('1.5×');
  });
});

describe('remainingSpeechText / splitSpokenText', () => {
  it('slices from the last spoken character', () => {
    expect(remainingSpeechText('hello world', 6)).toBe('world');
    expect(splitSpokenText('hello world', 6)).toEqual({ spoken: 'hello ', rest: 'world' });
    expect(remainingSpeechText('hello', -1)).toBe('hello');
    expect(remainingSpeechText('hello', 99)).toBe('');
  });
});

describe('sanitizeReadAloudVoiceURI', () => {
  it('trims and caps length', () => {
    expect(sanitizeReadAloudVoiceURI('  abc  ')).toBe('abc');
    expect(sanitizeReadAloudVoiceURI(null)).toBe('');
    expect(sanitizeReadAloudVoiceURI('x'.repeat(500)).length).toBe(400);
  });
});

describe('speech voices', () => {
  const voices = speechVoicesFromEngine([
    {
      voiceURI: 'com.apple.voice.fr-FR.Thomas',
      name: 'Thomas',
      lang: 'fr-FR',
      localService: true,
      default: false,
    },
    {
      voiceURI: 'com.apple.voice.en-US.Samantha',
      name: 'Samantha',
      lang: 'en-US',
      localService: true,
      default: true,
    },
    {
      voiceURI: 'com.apple.voice.en-GB.Daniel',
      name: 'Daniel',
      lang: 'en-GB',
      localService: true,
      default: false,
    },
  ]);

  it('groups by language with the preferred locale first', () => {
    const groups = groupSpeechVoices(voices, 'en-US');
    expect(groups.map((g) => g.lang)).toEqual(['en-US', 'en-GB', 'fr-FR']);
    expect(groups[0]?.voices[0]?.name).toBe('Samantha');
  });

  it('picks the saved URI, else the engine default', () => {
    expect(pickSpeechVoice(voices, 'com.apple.voice.en-GB.Daniel')?.name).toBe('Daniel');
    expect(pickSpeechVoice(voices)?.name).toBe('Samantha');
    expect(pickSpeechVoice(voices, 'missing')?.name).toBe('Samantha');
  });

  it('labels BCP-47 tags', () => {
    expect(speechVoiceLangLabel('en-US', 'en')).toMatch(/English/);
    expect(speechVoiceLangLabel('en-US', 'en')).toMatch(/United States/);
  });
});

describe('nudgeReadAloudRate', () => {
  it('steps by 0.1 and stops at the edges', () => {
    expect(nudgeReadAloudRate(1, 1)).toBe(1.1);
    expect(nudgeReadAloudRate(0.5, -1)).toBe(0.5);
    expect(nudgeReadAloudRate(3, 1)).toBe(3);
  });
});
