import { useCallback, useEffect, useRef, useState } from 'react';
import {
  composeDictationPrompt,
  dictationErrorMessage,
  speechEventTranscript,
  speechRecognitionCtor,
  speechRecognitionSupported,
  type SpeechRecognitionHandle,
} from './speech-dictation';

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
  const supported = speechRecognitionSupported();
  const recRef = useRef<SpeechRecognitionHandle | null>(null);
  const wantRef = useRef(false);
  const baseRef = useRef('');
  const getValueRef = useRef(opts.getValue);
  const setValueRef = useRef(opts.setValue);
  getValueRef.current = opts.getValue;
  setValueRef.current = opts.setValue;

  const stop = useCallback(() => {
    wantRef.current = false;
    const rec = recRef.current;
    if (!rec) {
      setListening(false);
      return;
    }
    try {
      rec.stop();
    } catch {
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      recRef.current = null;
      setListening(false);
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const start = useCallback(() => {
    if (opts.disabled) return;
    if (wantRef.current && recRef.current) return;
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setError('Dictation is not available in this window.');
      return;
    }
    if (recRef.current) stop();
    setError(null);

    const rec = new Ctor();
    rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    baseRef.current = getValueRef.current();
    rec.onstart = () => {
      if (!wantRef.current) return;
      setListening(true);
    };
    rec.onresult = (event) => {
      const spoken = speechEventTranscript(event.results);
      setValueRef.current(composeDictationPrompt(baseRef.current, spoken));
    };
    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(dictationErrorMessage(event.error));
      wantRef.current = false;
      setListening(false);
    };
    rec.onend = () => {
      if (wantRef.current) {
        try {
          rec.start();
          return;
        } catch {
          wantRef.current = false;
        }
      }
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      if (recRef.current === rec) recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
    } catch {
      wantRef.current = false;
      recRef.current = null;
      setListening(false);
      setError('Could not start dictation.');
      return;
    }

    const ask = window.sideboard.askMicrophoneAccess;
    if (typeof ask === 'function') void ask().catch(() => {});
  }, [opts.disabled, stop]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    stop();
  }, [opts.resetKey, stop]);

  return { listening, supported, error, start, stop };
}
