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
  toggle: () => void;
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
    setListening(false);
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const start = useCallback(async () => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setError('Dictation is not available in this window.');
      return;
    }
    stop();
    setError(null);
    try {
      const ask = window.sideboard.askMicrophoneAccess;
      if (typeof ask === 'function') {
        const ok = await ask();
        if (!ok) {
          setError(dictationErrorMessage('not-allowed'));
          return;
        }
      }
    } catch {
      setError(dictationErrorMessage('not-allowed'));
      return;
    }

    const rec = new Ctor();
    rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = getValueRef.current();
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
      if (!wantRef.current) {
        setListening(false);
        recRef.current = null;
        return;
      }
      baseRef.current = getValueRef.current();
      try {
        rec.start();
      } catch {
        wantRef.current = false;
        setListening(false);
        recRef.current = null;
      }
    };
    recRef.current = rec;
    wantRef.current = true;
    setListening(true);
    try {
      rec.start();
    } catch {
      wantRef.current = false;
      setListening(false);
      recRef.current = null;
      setError('Could not start dictation.');
    }
  }, [stop]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    stop();
  }, [opts.resetKey, stop]);

  const toggle = useCallback(() => {
    if (opts.disabled) return;
    if (wantRef.current) stop();
    else void start();
  }, [opts.disabled, start, stop]);

  return { listening, supported, error, toggle, stop };
}
