import { useCallback, useEffect, useRef, useState } from 'react';
import {
  arrayBufferToBase64,
  composeDictationPrompt,
  concatFloat32,
  DICTATION_MIN_RMS,
  DICTATION_MIN_SECONDS,
  DICTATION_TARGET_RATE,
  dictationCaptureSupported,
  dictationErrorMessage,
  downsampleMono,
  float32ToPcm16,
  prepareDictationWav,
} from './speech-dictation';

type MicSession = {
  finish: () => { samples: Float32Array; sampleRate: number };
};

function pcm16Base64(pcm: Uint8Array): string {
  return arrayBufferToBase64(
    pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
  );
}

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
  const baseRef = useRef('');
  const liveActiveRef = useRef(false);
  const liveReadyRef = useRef(false);
  const gotSpeechRef = useRef(false);
  const pendingSpokenRef = useRef<string | null>(null);
  const spokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const energyRef = useRef({ sumSq: 0, n: 0 });
  const unsubRef = useRef<(() => void) | null>(null);
  const getValueRef = useRef(opts.getValue);
  const setValueRef = useRef(opts.setValue);
  getValueRef.current = opts.getValue;
  setValueRef.current = opts.setValue;

  const detachLive = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    liveReadyRef.current = false;
    liveActiveRef.current = false;
    void window.sideboard.stopLiveDictation?.();
  }, []);

  const discard = useCallback(() => {
    genRef.current += 1;
    wantRef.current = false;
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.finish();
    if (spokenTimerRef.current) {
      clearTimeout(spokenTimerRef.current);
      spokenTimerRef.current = null;
    }
    pendingSpokenRef.current = null;
    detachLive();
    setListening(false);
  }, [detachLive]);

  const applySpokenNow = useCallback((spoken: string, gen: number) => {
    if (gen !== genRef.current) return;
    const next = spoken.replace(/\s+/g, ' ').trim();
    if (!next) return;
    gotSpeechRef.current = true;
    setError(null);
    setValueRef.current(composeDictationPrompt(baseRef.current, next));
  }, []);

  const applySpoken = useCallback(
    (spoken: string, gen: number) => {
      pendingSpokenRef.current = spoken;
      if (spokenTimerRef.current) return;
      spokenTimerRef.current = setTimeout(() => {
        spokenTimerRef.current = null;
        const pending = pendingSpokenRef.current;
        pendingSpokenRef.current = null;
        if (pending) applySpokenNow(pending, gen);
      }, 80);
    },
    [applySpokenNow],
  );

  const flushSpoken = useCallback(
    (gen: number) => {
      if (spokenTimerRef.current) {
        clearTimeout(spokenTimerRef.current);
        spokenTimerRef.current = null;
      }
      const pending = pendingSpokenRef.current;
      pendingSpokenRef.current = null;
      if (pending) applySpokenNow(pending, gen);
    },
    [applySpokenNow],
  );

  const bindLiveEvents = useCallback(
    (gen: number) => {
      unsubRef.current?.();
      const api = window.sideboard;
      const offT = api.onLiveDictationTranscript?.((payload) => {
        applySpoken(payload.text, gen);
      });
      const offE = api.onLiveDictationError?.((payload) => {
        if (gen !== genRef.current) return;
        if (gotSpeechRef.current) return;
        setError(payload.message);
      });
      unsubRef.current = () => {
        offT?.();
        offE?.();
      };
    },
    [applySpoken],
  );

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
        applySpokenNow(spoken, gen);
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        setError(err instanceof Error ? err.message : dictationErrorMessage(undefined));
      })
      .finally(() => {
        if (gen === genRef.current) setListening(false);
      });
  }, [applySpokenNow]);

  const stop = useCallback(() => {
    wantRef.current = false;
    const gen = genRef.current;
    const pending = startingRef.current;
    const live = liveActiveRef.current;
    void (async () => {
      if (pending) await pending;
      if (gen !== genRef.current) return;
      const session = sessionRef.current;
      sessionRef.current = null;
      const clip = session?.finish() ?? { samples: new Float32Array(0), sampleRate: DICTATION_TARGET_RATE };
      if (live) {
        liveReadyRef.current = false;
        liveActiveRef.current = false;
        try {
          await window.sideboard.stopLiveDictation?.();
        } catch {
          /* helper already gone */
        }
        if (gen !== genRef.current) return;
        flushSpoken(gen);
        if (!gotSpeechRef.current) {
          const seconds = energyRef.current.n / (clip.sampleRate || DICTATION_TARGET_RATE);
          const rms =
            energyRef.current.n > 0
              ? Math.sqrt(energyRef.current.sumSq / energyRef.current.n)
              : 0;
          if (seconds < DICTATION_MIN_SECONDS) {
            setError(dictationErrorMessage('too-short'));
          } else if (rms < DICTATION_MIN_RMS) {
            setError(dictationErrorMessage('silent'));
          } else {
            setError(dictationErrorMessage('no-speech'));
          }
        }
        unsubRef.current?.();
        unsubRef.current = null;
        setListening(false);
        return;
      }
      transcribe(clip.samples, clip.sampleRate, gen);
    })();
  }, [flushSpoken, transcribe]);

  const start = useCallback(() => {
    if (opts.disabled) return;
    if (wantRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Dictation is not available in this window.');
      return;
    }
    wantRef.current = true;
    genRef.current += 1;
    const gen = genRef.current;
    baseRef.current = getValueRef.current();
    gotSpeechRef.current = false;
    liveActiveRef.current = false;
    liveReadyRef.current = false;
    pendingSpokenRef.current = null;
    energyRef.current = { sumSq: 0, n: 0 };
    if (spokenTimerRef.current) {
      clearTimeout(spokenTimerRef.current);
      spokenTimerRef.current = null;
    }
    setError(null);
    setListening(true);
    bindLiveEvents(gen);

    const work = (async () => {
      const ask = window.sideboard.askMicrophoneAccess;
      if (typeof ask === 'function') {
        const allowed = await ask();
        if (!wantRef.current || gen !== genRef.current) return;
        if (!allowed) {
          wantRef.current = false;
          setListening(false);
          setError(dictationErrorMessage('NotAllowedError'));
          return;
        }
      }
      const locale = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
      const startLive = window.sideboard.startLiveDictation;
      const liveP =
        typeof startLive === 'function'
          ? startLive(locale).then(() => {
              if (gen !== genRef.current || !wantRef.current) return;
              liveActiveRef.current = true;
              liveReadyRef.current = true;
            })
          : Promise.resolve();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      if (!wantRef.current || gen !== genRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new AudioContext();
      await ctx.resume();
      if (!wantRef.current || gen !== genRef.current) {
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
        const channel = event.inputBuffer.getChannelData(0);
        const energy = energyRef.current;
        for (let i = 0; i < channel.length; i++) {
          const v = channel[i] ?? 0;
          energy.sumSq += v * v;
          energy.n += 1;
        }
        const live = liveReadyRef.current;
        if (!live) {
          chunks.push(new Float32Array(channel));
        }
        const down = downsampleMono(channel, ctx.sampleRate || 48_000, DICTATION_TARGET_RATE);
        if (down.length === 0) return;
        if (live) {
          window.sideboard.pushLiveDictationAudio?.(pcm16Base64(float32ToPcm16(down)));
        }
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
      try {
        await liveP;
      } catch {
        liveActiveRef.current = false;
        liveReadyRef.current = false;
      }
    })();

    const tracked = work.catch((err) => {
      wantRef.current = false;
      sessionRef.current = null;
      detachLive();
      setListening(false);
      const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
      setError(dictationErrorMessage(name || undefined));
    });
    startingRef.current = tracked.finally(() => {
      if (startingRef.current === tracked) startingRef.current = null;
    });
  }, [bindLiveEvents, detachLive, opts.disabled]);

  useEffect(() => () => discard(), [discard]);
  useEffect(() => {
    discard();
  }, [opts.resetKey, discard]);

  const clearError = useCallback(() => setError(null), []);

  return { listening, supported, error, clearError, start, stop };
}
