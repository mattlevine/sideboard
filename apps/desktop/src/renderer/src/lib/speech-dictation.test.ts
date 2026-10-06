import { describe, expect, it } from 'vitest';
import {
  arrayBufferToBase64,
  composeDictationPrompt,
  concatFloat32,
  dictationCaptureSupported,
  dictationErrorMessage,
  dictationPermissionDialogCopy,
  dictationPrivacySettingsUrl,
  dictationTccNames,
  encodeWavPcm16,
  float32ToPcm16,
  isDictationPermissionError,
  prepareDictationWav,
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

  it('replaces growing live partials when the base stays fixed', () => {
    const base = 'Fix';
    expect(composeDictationPrompt(base, 'the')).toBe('Fix the');
    expect(composeDictationPrompt(base, 'the login')).toBe('Fix the login');
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

describe('float32ToPcm16', () => {
  it('encodes little-endian frames', () => {
    const pcm = float32ToPcm16(new Float32Array([0, 1, -1]));
    expect(pcm.byteLength).toBe(6);
    const view = new DataView(pcm.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0x7fff);
    expect(view.getInt16(4, true)).toBe(-0x8000);
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
    expect(isDictationPermissionError(dictationErrorMessage('not-allowed'))).toBe(true);
    expect(isDictationPermissionError(dictationErrorMessage('silent'))).toBe(true);
    expect(
      isDictationPermissionError(
        'Speech recognition is blocked. Allow Sideboard Dictation in System Settings → Privacy & Security → Speech Recognition.',
      ),
    ).toBe(true);
    expect(isDictationPermissionError(dictationErrorMessage('too-short'))).toBe(false);
    expect(dictationPrivacySettingsUrl('Speech recognition is blocked.')).toMatch(
      /Privacy_SpeechRecognition/,
    );
    expect(dictationPrivacySettingsUrl(dictationErrorMessage('not-allowed'))).toMatch(
      /Privacy_Microphone/,
    );
  });

  it('names Electron in Dev and Sideboard Dictation for speech', () => {
    expect(dictationTccNames(false)).toEqual({
      microphoneApp: 'Electron',
      speechApp: 'Sideboard Dictation',
    });
    expect(dictationTccNames(true).microphoneApp).toBe('Sideboard');
    const devMic = dictationPermissionDialogCopy(dictationErrorMessage('not-allowed'), false);
    expect(devMic.message).toMatch(/Electron/);
    expect(devMic.message).toMatch(/not listed as Sideboard/);
    expect(devMic.message).toMatch(/Sideboard Dictation/);
    const packagedSpeech = dictationPermissionDialogCopy(
      'Speech recognition is blocked.',
      true,
    );
    expect(packagedSpeech.title).toMatch(/speech recognition/i);
    expect(packagedSpeech.message).toMatch(/Sideboard Dictation/);
    expect(packagedSpeech.message).not.toMatch(/Dev window/);
  });

  it('tells the user to click again after a short clip', () => {
    expect(dictationErrorMessage('too-short')).toMatch(/Click the mic/i);
  });
});

describe('prepareDictationWav', () => {
  it('downsamples to 16 kHz and reports energy', () => {
    const samples = new Float32Array(48_000);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 20) * 0.2;
    const prepared = prepareDictationWav(samples, 48_000);
    expect(prepared.seconds).toBeCloseTo(1, 2);
    expect(prepared.rms).toBeGreaterThan(0.05);
    expect(prepared.wav.byteLength).toBe(44 + 16_000 * 2);
  });
});
