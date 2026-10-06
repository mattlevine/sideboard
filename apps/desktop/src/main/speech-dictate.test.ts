import { describe, expect, it } from 'vitest';
import { mapSpeechDictateError, speechDictateSourcePaths } from './speech-dictate-util';

describe('mapSpeechDictateError', () => {
  it('explains a blocked speech-recognition grant', () => {
    expect(mapSpeechDictateError('not-authorized\n')).toMatch(/Speech recognition is blocked/i);
  });

  it('uses the last stderr line', () => {
    expect(mapSpeechDictateError('debug\ntimeout')).toMatch(/timed out/i);
  });
});

describe('speechDictateSourcePaths', () => {
  it('resolves helper sources next to the native folder', () => {
    const paths = speechDictateSourcePaths('/tmp/native');
    expect(paths.swift).toBe('/tmp/native/speech-dictate.swift');
    expect(paths.plist).toBe('/tmp/native/speech-dictate-Info.plist');
  });
});
