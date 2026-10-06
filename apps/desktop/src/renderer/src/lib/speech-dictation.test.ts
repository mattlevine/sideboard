import { describe, expect, it } from 'vitest';
import {
  arrayBufferToBase64,
  composeDictationPrompt,
  concatFloat32,
  dictationCaptureSupported,
  dictationErrorMessage,
  encodeWavPcm16,
} from './speech-dictation';

describe('composeDictationPrompt', () => {
  it('uses spoken text when the field is empty', () => {
    expect(composeDictationPrompt('', '  ship the  menu ')).toBe('ship the menu');
    expect(composeDictationPrompt('   ', 'hello')).toBe('hello');
  });

  it('inserts a space before new speech', () => {
    expect(composeDictationPrompt('Fix', 'the login')).toBe('Fix the login');
    expect(composeDictationPrompt('Fix ', 'the login')).toBe('Fix the login');
  });

  it('ignores empty speech', () => {
    expect(composeDictationPrompt('Keep', '   ')).toBe('Keep');
  });
});

describe('dictationCaptureSupported', () => {
  it('requires getUserMedia', () => {
    expect(dictationCaptureSupported({})).toBe(false);
    expect(dictationCaptureSupported({ mediaDevices: { getUserMedia: async () => null } })).toBe(
      true,
    );
  });
});

describe('encodeWavPcm16', () => {
  it('writes a mono PCM WAV header', () => {
    const wav = encodeWavPcm16(concatFloat32([new Float32Array([0, 0.5, -0.5])]), 16_000);
    const bytes = new Uint8Array(wav);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(bytes.byteLength).toBe(44 + 6);
    expect(arrayBufferToBase64(wav).length).toBeGreaterThan(8);
  });
});

describe('dictationErrorMessage', () => {
  it('explains blocked mic access', () => {
    expect(dictationErrorMessage('not-allowed')).toMatch(/Microphone access/i);
  });
});
