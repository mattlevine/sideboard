import { describe, expect, it } from 'vitest';
import {
  composeDictationPrompt,
  dictationErrorMessage,
  speechEventTranscript,
  speechRecognitionSupported,
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

describe('speechEventTranscript', () => {
  it('joins engine result transcripts', () => {
    expect(
      speechEventTranscript([{ 0: { transcript: 'hello ' } }, { 0: { transcript: 'world' } }]),
    ).toBe('hello world');
  });
});

describe('speechRecognitionSupported', () => {
  it('detects the Chromium webkit constructor', () => {
    expect(speechRecognitionSupported({})).toBe(false);
    expect(speechRecognitionSupported({ webkitSpeechRecognition: function Webkit() {} })).toBe(
      true,
    );
  });
});

describe('dictationErrorMessage', () => {
  it('explains blocked mic access', () => {
    expect(dictationErrorMessage('not-allowed')).toMatch(/Microphone access/i);
  });
});
