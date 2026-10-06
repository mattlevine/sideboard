import { useCallback, useEffect, useRef, useState } from 'react';
import {
  arrayBufferToBase64,
  composeDictationPrompt,
  concatFloat32,
  dictationCaptureSupported,
  dictationErrorMessage,
  encodeWavPcm16,
} from './speech-dictation';

type MicSession = {
  finish: () => ArrayBuffer;
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
  start: () => void;
  stop: () => void;
} {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = dictationCaptureSupported();
  const wantRef = useRef(false);
  const sessionRef = useRef<MicSession | null>(null);
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

  const stop = useCallback(() => {
    wantRef.current = false;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) {
      setListening(false);
      return;
    }
    const gen = genRef.current;
    const wav = session.finish();
    const locale = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    const transcribe = window.sideboard.transcribeDictation;
    if (typeof transcribe !== 'function') {
      setListening(false);
      setError('Dictation is not available in this window.');
      return;
    }
    void transcribe(arrayBufferToBase64(wav), locale)
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
    const ask = window.sideboard.askMicrophoneAccess;
    if (typeof ask === 'function') void ask().catch(() => {});

    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(async (stream) => {
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
        const chunks: Float32Array[] = [];
        proc.onaudioprocess = (event) => {
          if (!wantRef.current) return;
          chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        const mute = ctx.createGain();
        mute.gain.value = 0;
        src.connect(proc);
        proc.connect(mute);
        mute.connect(ctx.destination);
        sessionRef.current = {
          finish: () => {
            try {
              proc.disconnect();
              src.disconnect();
              mute.disconnect();
            } catch {
              /* ignore */
            }
            stream.getTracks().forEach((t) => t.stop());
            const rate = ctx.sampleRate || 48_000;
            void ctx.close();
            return encodeWavPcm16(concatFloat32(chunks), rate);
          },
        };
      })
      .catch((err) => {
        wantRef.current = false;
        sessionRef.current = null;
        setListening(false);
        const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
        setError(dictationErrorMessage(name || undefined));
      });
  }, [opts.disabled]);

  useEffect(() => () => discard(), [discard]);
  useEffect(() => {
    discard();
  }, [opts.resetKey, discard]);

  return { listening, supported, error, start, stop };
}
