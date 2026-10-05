import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  READ_ALOUD_RATE_MAX,
  READ_ALOUD_RATE_MIN,
  READ_ALOUD_RATE_STEP,
  clampReadAloudRate,
  formatReadAloudRate,
  groupSpeechVoices,
  nudgeReadAloudRate,
  pickSpeechVoice,
  remainingSpeechText,
  sanitizeReadAloudVoiceURI,
  speechVoicesFromEngine,
  splitSpokenText,
  type SpeechVoiceInfo,
} from '../lib/read-aloud';

type PlayState = 'speaking' | 'paused' | 'ended';

interface Props {
  text: string;
  rate: number;
  voiceURI: string;
  onDefaultsChange: (next: { rate: number; voiceURI: string }) => void;
  onClose: () => void;
}

function loadVoices(): SpeechVoiceInfo[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechVoicesFromEngine(speechSynthesis.getVoices());
}

export function ReadAloudModal({
  text,
  rate: initialRate,
  voiceURI: initialVoiceURI,
  onDefaultsChange,
  onClose,
}: Props) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [rate, setRate] = useState(() => clampReadAloudRate(initialRate));
  const [voiceURI, setVoiceURI] = useState(() => sanitizeReadAloudVoiceURI(initialVoiceURI));
  const [voices, setVoices] = useState<SpeechVoiceInfo[]>(() => loadVoices());
  const [playState, setPlayState] = useState<PlayState>(supported ? 'speaking' : 'ended');
  const [charIndex, setCharIndex] = useState(0);
  const [error, setError] = useState<string | null>(
    supported ? null : 'Read Aloud is not available in this window.',
  );

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const originRef = useRef(0);
  const charIndexRef = useRef(0);
  const playStateRef = useRef(playState);
  playStateRef.current = playState;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const voiceURIRef = useRef(voiceURI);
  voiceURIRef.current = voiceURI;
  const voicesRef = useRef(voices);
  voicesRef.current = voices;
  const persistTimer = useRef<number | null>(null);
  const keepAlive = useRef<number | null>(null);
  const generation = useRef(0);
  const speakFromRef = useRef<(fromIndex: number, nextRate?: number, nextVoiceURI?: string) => void>(
    () => undefined,
  );

  const groups = useMemo(
    () => groupSpeechVoices(voices, typeof navigator !== 'undefined' ? navigator.language : 'en'),
    [voices],
  );
  const selected = useMemo(() => pickSpeechVoice(voices, voiceURI), [voices, voiceURI]);
  const preview = useMemo(() => splitSpokenText(text, charIndex), [text, charIndex]);

  const persistDefaults = useCallback(
    (nextRate: number, nextVoice: string, immediate = false) => {
      const write = () =>
        onDefaultsChange({
          rate: clampReadAloudRate(nextRate),
          voiceURI: sanitizeReadAloudVoiceURI(nextVoice),
        });
      if (persistTimer.current != null) window.clearTimeout(persistTimer.current);
      if (immediate) {
        persistTimer.current = null;
        write();
        return;
      }
      persistTimer.current = window.setTimeout(write, 250);
    },
    [onDefaultsChange],
  );

  const stopKeepAlive = useCallback(() => {
    if (keepAlive.current != null) {
      window.clearInterval(keepAlive.current);
      keepAlive.current = null;
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    stopKeepAlive();
    generation.current += 1;
    try {
      speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    utteranceRef.current = null;
  }, [stopKeepAlive]);

  const speakFrom = useCallback(
    (fromIndex: number, nextRate = rateRef.current, nextVoiceURI = voiceURIRef.current) => {
      if (!supported) return;
      const remaining = remainingSpeechText(text, fromIndex);
      if (!remaining.trim()) {
        cancelSpeech();
        originRef.current = text.length;
        charIndexRef.current = text.length;
        setCharIndex(text.length);
        setPlayState('ended');
        return;
      }
      cancelSpeech();
      const gen = generation.current;
      const utterance = new SpeechSynthesisUtterance(remaining);
      utterance.rate = clampReadAloudRate(nextRate);
      const voice = pickSpeechVoice(voicesRef.current, nextVoiceURI);
      if (voice) {
        const match = speechSynthesis.getVoices().find((v) => v.voiceURI === voice.voiceURI);
        if (match) utterance.voice = match;
        utterance.lang = voice.lang;
      }
      originRef.current = Math.max(0, Math.min(text.length, Math.floor(fromIndex)));
      utterance.onboundary = (event) => {
        if (gen !== generation.current) return;
        const abs = originRef.current + (Number.isFinite(event.charIndex) ? event.charIndex : 0);
        charIndexRef.current = abs;
        setCharIndex(abs);
      };
      utterance.onend = () => {
        if (gen !== generation.current) return;
        originRef.current = text.length;
        charIndexRef.current = text.length;
        setCharIndex(text.length);
        setPlayState('ended');
        stopKeepAlive();
      };
      utterance.onerror = (event) => {
        if (gen !== generation.current) return;
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        setPlayState('ended');
        setError('Could not read this selection.');
        stopKeepAlive();
      };
      utteranceRef.current = utterance;
      setError(null);
      setPlayState('speaking');
      window.setTimeout(() => {
        if (gen !== generation.current) return;
        speechSynthesis.speak(utterance);
        stopKeepAlive();
        keepAlive.current = window.setInterval(() => {
          if (playStateRef.current !== 'speaking' || !speechSynthesis.speaking) return;
          try {
            speechSynthesis.pause();
            speechSynthesis.resume();
          } catch {
            /* ignore */
          }
        }, 12_000);
      }, 0);
    },
    [cancelSpeech, stopKeepAlive, supported, text],
  );
  speakFromRef.current = speakFrom;

  useEffect(() => {
    function refreshVoices() {
      const next = loadVoices();
      const wasEmpty = voicesRef.current.length === 0;
      setVoices(next);
      if (wasEmpty && next.length > 0 && playStateRef.current !== 'ended') {
        speakFromRef.current(charIndexRef.current);
      }
    }
    refreshVoices();
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, []);

  useEffect(() => {
    if (!supported) return;
    originRef.current = 0;
    charIndexRef.current = 0;
    setCharIndex(0);
    speakFrom(0);
    return () => {
      cancelSpeech();
    };
  }, [cancelSpeech, speakFrom, supported, text]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (persistTimer.current != null) window.clearTimeout(persistTimer.current);
      persistDefaults(rateRef.current, voiceURIRef.current, true);
    };
  }, [persistDefaults]);

  function applyRate(next: number) {
    const clamped = clampReadAloudRate(next);
    setRate(clamped);
    persistDefaults(clamped, voiceURI);
    if (playState === 'speaking' || playState === 'paused') {
      speakFrom(charIndexRef.current, clamped, voiceURI);
    }
  }

  function applyVoice(nextURI: string) {
    const uri = sanitizeReadAloudVoiceURI(nextURI);
    setVoiceURI(uri);
    persistDefaults(rate, uri, true);
    if (playState === 'speaking' || playState === 'paused') {
      speakFrom(charIndexRef.current, rate, uri);
    }
  }

  function togglePause() {
    if (!supported) return;
    if (playState === 'ended') {
      originRef.current = 0;
      charIndexRef.current = 0;
      setCharIndex(0);
      speakFrom(0);
      return;
    }
    if (playState === 'paused') {
      try {
        speechSynthesis.resume();
        setPlayState('speaking');
      } catch {
        speakFrom(charIndexRef.current);
      }
      return;
    }
    try {
      speechSynthesis.pause();
      setPlayState('paused');
    } catch {
      /* ignore */
    }
  }

  function stop() {
    cancelSpeech();
    originRef.current = 0;
    charIndexRef.current = 0;
    setCharIndex(0);
    setPlayState('ended');
  }

  function close() {
    persistDefaults(rate, voiceURI, true);
    cancelSpeech();
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal confirm-modal read-aloud-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="read-aloud-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="read-aloud-title">Read Aloud</h3>
        <p className="read-aloud-preview" aria-live="polite">
          {preview.spoken ? <span className="read-aloud-spoken">{preview.spoken}</span> : null}
          <span className="read-aloud-rest">{preview.rest}</span>
        </p>
        {error ? <p className="land-confirm-error">{error}</p> : null}

        <label className="read-aloud-field" htmlFor="read-aloud-voice">
          Voice
          <select
            id="read-aloud-voice"
            className="read-aloud-select"
            value={selected?.voiceURI ?? ''}
            disabled={!supported || groups.length === 0}
            onChange={(e) => applyVoice(e.target.value)}
          >
            {groups.length === 0 ? <option value="">System default</option> : null}
            {groups.map((group) => (
              <optgroup key={group.lang} label={group.label}>
                {group.voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name}
                    {voice.localService ? '' : ' (online)'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="read-aloud-field">
          <div className="read-aloud-rate-label">
            <span>Speed</span>
            <span className="read-aloud-rate-value">{formatReadAloudRate(rate)}</span>
          </div>
          <div className="read-aloud-rate-row">
            <button
              type="button"
              aria-label="Slower"
              disabled={!supported || rate <= READ_ALOUD_RATE_MIN}
              onClick={() => applyRate(nudgeReadAloudRate(rate, -1))}
            >
              −
            </button>
            <input
              type="range"
              aria-label="Reading speed"
              min={READ_ALOUD_RATE_MIN}
              max={READ_ALOUD_RATE_MAX}
              step={READ_ALOUD_RATE_STEP}
              value={rate}
              disabled={!supported}
              onChange={(e) => applyRate(Number(e.target.value))}
            />
            <button
              type="button"
              aria-label="Faster"
              disabled={!supported || rate >= READ_ALOUD_RATE_MAX}
              onClick={() => applyRate(nudgeReadAloudRate(rate, 1))}
            >
              +
            </button>
          </div>
        </div>

        <div className="row read-aloud-actions">
          <button type="button" onClick={close}>
            Close
          </button>
          <button type="button" disabled={!supported} onClick={stop}>
            Stop
          </button>
          <button type="button" className="primary" disabled={!supported} onClick={togglePause}>
            {playState === 'ended' ? 'Play' : playState === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
    </div>
  );
}
