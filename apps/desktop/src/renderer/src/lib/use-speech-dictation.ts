import { useCallback, useEffect, useRef, useState } from 'react';
import {
  arrayBufferToBase64,
  composeDictationPrompt,
  concatFloat32,
  DICTATION_MIN_RMS,
  DICTATION_MIN_SECONDS,
  dictationCaptureSupported,
  dictationErrorMessage,
  prepareDictationWav,
} from './speech-dictation';

type MicSession = {
  finish: () => { samples: Float32Array; sampleRate: number };
};

export function useSpeechDictation(opts: {
  getValue: () => string;
  setValue: (next: string) => void;
  resetKey?: string;
  disabled?: boolean;
}): {
  listening: boolean;
  supported: boolean;
  error: string | null;
  clearError: () => void;
  start: () => void;
  stop: () => void;
} {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = dictationCaptureSupported();
  const wantRef = useRef(false);
  const sessionRef = useRef<MicSession | null>(null);
  const startingRef = useRef<Promise<void> | null>(null);
  const genRef = useRef(0);
  const getValueRef = useRef(opts.getValue);
  const setValueRef = useRef(opts.setValue);
  getValueRef.current = opts.getValue;
  setValueRef.current = opts.setValue;

  const discard = useCallback(() => {
    genRef.current += 1;
    wantRef.current = false;
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.finish();
    setListening(false);
  }, []);

  const transcribe = useCallback((samples: Float32Array, sampleRate: number, gen: number) => {
    const prepared = prepareDictationWav(samples, sampleRate);
    if (prepared.seconds < DICTATION_MIN_SECONDS) {
      setListening(false);
      setError(dictationErrorMessage('too-short'));
      return;
    }
    if (prepared.rms < DICTATION_MIN_RMS) {
      setListening(false);
      setError(dictationErrorMessage('silent'));
      return;
    }
    const run = window.sideboard.transcribeDictation;
    if (typeof run !== 'function') {
      setListening(false);
      setError('Dictation is not available in this window.');
      return;
    }
    const locale = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    void run(arrayBufferToBase64(prepared.wav), locale)
      .then((spoken) => {
        if (gen !== genRef.current) return;
        if (!spoken.trim()) {
          setError(dictationErrorMessage('no-speech'));
          return;
        }
        setError(null);
        setValueRef.current(composeDictationPrompt(getValueRef.current(), spoken));
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err.message : dictationErrorMessage(undefined));
      })
      .finally(() => {
        if (gen === genRef.current) setListening(false);
      });
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    const gen = genRef.current;
    const pending = startingRef.current;
    void (async () => {
      if (pending) await pending;
      if (gen !== genRef.current) return;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (!session) {
        setListening(false);
        return;
      }
      const clip = session.finish();
      transcribe(clip.samples, clip.sampleRate, gen);
    })();
  }, [transcribe]);

  const start = useCallback(() => {
    if (opts.disabled) return;
    if (wantRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Dictation is not available in this window.');
      return;
    }
    wantRef.current = true;
    genRef.current += 1;
    setError(null);
    setListening(true);

    const work = (async () => {
      const ask = window.sideboard.askMicrophoneAccess;
      if (typeof ask === 'function') {
        const allowed = await ask();
        if (!wantRef.current) return;
        if (!allowed) {
          wantRef.current = false;
          setListening(false);
          setError(dictationErrorMessage('NotAllowedError'));
          return;
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      if (!wantRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new AudioContext();
      await ctx.resume();
      if (!wantRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        return;
      }
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const sink = ctx.createMediaStreamDestination();
      const keep = ctx.createGain();
      keep.gain.value = 0.00004;
      const osc = ctx.createOscillator();
      const chunks: Float32Array[] = [];
      proc.onaudioprocess = (event) => {
        if (!wantRef.current) return;
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      src.connect(proc);
      proc.connect(sink);
      proc.connect(keep);
      osc.connect(keep);
      keep.connect(ctx.destination);
      osc.start();
      sessionRef.current = {
        finish: () => {
          try {
            osc.stop();
            proc.disconnect();
            src.disconnect();
            sink.disconnect();
            keep.disconnect();
          } catch {
            /* ignore */
          }
          stream.getTracks().forEach((t) => t.stop());
          const sampleRate = ctx.sampleRate || 48_000;
          void ctx.close();
          return { samples: concatFloat32(chunks), sampleRate };
        },
      };
    })();

    const tracked = work.catch((err) => {
      wantRef.current = false;
      sessionRef.current = null;
      setListening(false);
      const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
      setError(dictationErrorMessage(name || undefined));
    });
    startingRef.current = tracked.finally(() => {
      if (startingRef.current === tracked) startingRef.current = null;
    });
  }, [opts.disabled]);

  useEffect(() => () => discard(), [discard]);
  useEffect(() => {
    discard();
  }, [opts.resetKey, discard]);

  const clearError = useCallback(() => setError(null), []);

  return { listening, supported, error, clearError, start, stop };
}
