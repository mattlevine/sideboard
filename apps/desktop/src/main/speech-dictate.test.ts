import { describe, expect, it } from 'vitest';
import {
  mapSpeechDictateError,
  speechDictateOpenArgs,
  speechDictateSourcePaths,
} from './speech-dictate-util';

describe('mapSpeechDictateError', () => {
  it('explains a blocked speech-recognition grant', () => {
    expect(mapSpeechDictateError('not-authorized\n')).toMatch(/Speech recognition is blocked/i);
  });

  it('uses the last stderr line', () => {
    expect(mapSpeechDictateError('debug\ntimeout')).toMatch(/timed out/i);
  });

  it('maps Apple no-speech stderr', () => {
    expect(mapSpeechDictateError('No speech detected')).toMatch(/Click the mic/i);
  });

  it('maps a TCC abort from execFile', () => {
    expect(
      mapSpeechDictateError(
        'Command failed: /tmp/speech-dictate.app/Contents/MacOS/speech-dictate /tmp/clip.wav en-US',
      ),
    ).toMatch(/Speech recognition is blocked/i);
  });
});

describe('speechDictateSourcePaths', () => {
  it('resolves helper sources next to the native folder', () => {
    const paths = speechDictateSourcePaths('/tmp/native');
    expect(paths.swift).toBe('/tmp/native/speech-dictate.swift');
    expect(paths.plist).toBe('/tmp/native/speech-dictate-Info.plist');
  });
});

describe('speechDictateOpenArgs', () => {
  it('launches the .app via LaunchServices so TCC sees its usage description', () => {
    expect(
      speechDictateOpenArgs({
        appRoot: '/tmp/speech-dictate.app',
        wavPath: '/tmp/clip.wav',
        locale: 'en-US',
        stdoutPath: '/tmp/out.txt',
        stderrPath: '/tmp/err.txt',
      }),
    ).toEqual([
      '-W',
      '-n',
      '-g',
      '-j',
      '-a',
      '/tmp/speech-dictate.app',
      '--stdout',
      '/tmp/out.txt',
      '--stderr',
      '/tmp/err.txt',
      '--args',
      '/tmp/clip.wav',
      'en-US',
    ]);
  });
});
