import { describe, expect, it } from 'vitest';
import {
  isFifoWouldBlock,
  mapSpeechDictateError,
  parseLiveDictateLine,
  speechDictateLiveOpenArgs,
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

describe('speechDictateLiveOpenArgs', () => {
  it('starts the helper without waiting so PCM can stream', () => {
    expect(
      speechDictateLiveOpenArgs({
        appRoot: '/tmp/speech-dictate.app',
        fifoPath: '/tmp/in.pcm',
        locale: 'en-US',
        stdoutPath: '/tmp/out.jsonl',
        stderrPath: '/tmp/err.txt',
      }),
    ).toEqual([
      '-n',
      '-g',
      '-j',
      '-a',
      '/tmp/speech-dictate.app',
      '--stdout',
      '/tmp/out.jsonl',
      '--stderr',
      '/tmp/err.txt',
      '--args',
      '--live',
      '/tmp/in.pcm',
      'en-US',
    ]);
  });
});

describe('parseLiveDictateLine', () => {
  it('reads ready, partial, and final lines', () => {
    expect(parseLiveDictateLine('{"k":"r","t":""}')).toEqual({ k: 'r', t: '' });
    expect(parseLiveDictateLine('{"k":"p","t":"hello"}')).toEqual({ k: 'p', t: 'hello' });
    expect(parseLiveDictateLine('{"k":"f","t":"hello world"}')).toEqual({
      k: 'f',
      t: 'hello world',
    });
  });

  it('ignores junk', () => {
    expect(parseLiveDictateLine('')).toBeNull();
    expect(parseLiveDictateLine('not json')).toBeNull();
  });
});

describe('isFifoWouldBlock', () => {
  it('treats a full pipe as non-fatal', () => {
    expect(isFifoWouldBlock({ code: 'EAGAIN' })).toBe(true);
    expect(isFifoWouldBlock({ code: 'EWOULDBLOCK' })).toBe(true);
    expect(isFifoWouldBlock({ code: 'EPIPE' })).toBe(false);
  });
});
