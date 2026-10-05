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
    rec.onstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const start = useCallback(() => {
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
    if (typeof ask !== 'function') return;
    void ask()
      .then((ok) => {
        if (ok || !wantRef.current) return;
        stop();
        setError(dictationErrorMessage('not-allowed'));
      })
      .catch(() => {
        if (!wantRef.current) return;
        stop();
        setError(dictationErrorMessage('not-allowed'));
      });
  }, [stop]);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    stop();
  }, [opts.resetKey, stop]);

  const toggle = useCallback(() => {
    if (opts.disabled) return;
    if (wantRef.current) stop();
    else start();
  }, [opts.disabled, start, stop]);

  return { listening, supported, error, toggle, stop };
}
