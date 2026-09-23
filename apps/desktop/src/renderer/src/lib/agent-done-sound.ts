import type { AgentDoneSound } from '@sideboard-ai/core';

/** Runtime guard — keep out of `@sideboard-ai/core` barrel imports in the renderer. */
export function isAgentDoneSound(value: unknown): value is AgentDoneSound {
  return (
    value === 'none' ||
    value === 'goal' ||
    value === 'bell' ||
    value === 'level' ||
    value === 'coin' ||
    value === 'fanfare' ||
    value === 'magic' ||
    value === 'rooster' ||
    value === 'whistle' ||
    value === 'custom'
  );
}

/** Labels for Settings → Advanced → Agent done sound. */
export const AGENT_DONE_SOUND_OPTIONS: ReadonlyArray<{
  value: AgentDoneSound;
  label: string;
}> = [
  { value: 'none', label: 'Off' },
  { value: 'goal', label: 'Score cheer' },
  { value: 'bell', label: 'Bell' },
  { value: 'level', label: 'Level up' },
  { value: 'coin', label: 'Coin' },
  { value: 'fanfare', label: 'Fanfare' },
  { value: 'magic', label: 'Magic' },
  { value: 'rooster', label: 'Rooster' },
  { value: 'whistle', label: 'Whistle' },
  { value: 'custom', label: 'Custom' },
];

const BUILTIN_URLS: Partial<Record<AgentDoneSound, string>> = {
  goal: new URL('../assets/agent-done-sounds/goal.mp3', import.meta.url).href,
  bell: new URL('../assets/agent-done-sounds/bell.mp3', import.meta.url).href,
  level: new URL('../assets/agent-done-sounds/level.mp3', import.meta.url).href,
  coin: new URL('../assets/agent-done-sounds/coin.mp3', import.meta.url).href,
  fanfare: new URL('../assets/agent-done-sounds/fanfare.mp3', import.meta.url).href,
  magic: new URL('../assets/agent-done-sounds/magic.mp3', import.meta.url).href,
  rooster: new URL('../assets/agent-done-sounds/rooster.mp3', import.meta.url).href,
  whistle: new URL('../assets/agent-done-sounds/whistle.mp3', import.meta.url).href,
};

/** Cap longer Mixkit clips so agent-done stays a short cue. */
const MAX_PLAY_SECONDS: Partial<Record<AgentDoneSound, number>> = {
  goal: 3.5,
  fanfare: 3.5,
  rooster: 3.0,
};

let sharedCtx: AudioContext | null = null;
let activeHtmlAudio: HTMLAudioElement | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AC();
  }
  return sharedCtx;
}

function stopHtmlAudio(): void {
  if (!activeHtmlAudio) return;
  try {
    activeHtmlAudio.pause();
    activeHtmlAudio.removeAttribute('src');
    activeHtmlAudio.load();
  } catch {
    /* ignore */
  }
  activeHtmlAudio = null;
}

function playHtmlAudio(url: string, maxSeconds?: number): void {
  stopHtmlAudio();
  const audio = new Audio(url);
  audio.volume = 0.9;
  activeHtmlAudio = audio;
  const clear = () => {
    if (activeHtmlAudio === audio) activeHtmlAudio = null;
  };
  audio.addEventListener('ended', clear);
  audio.addEventListener('error', clear);
  void audio.play().catch(() => {
    clear();
  });
  if (maxSeconds != null && maxSeconds > 0) {
    window.setTimeout(() => {
      if (activeHtmlAudio !== audio) return;
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
      clear();
    }, Math.round(maxSeconds * 1000));
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function playCustomSound(ctx: AudioContext): Promise<void> {
  const payload = await window.sideboard.getAgentDoneCustomSound();
  if (!payload?.dataBase64) return;
  const buffer = await ctx.decodeAudioData(base64ToArrayBuffer(payload.dataBase64).slice(0));
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9, ctx.currentTime);
  src.connect(g);
  g.connect(ctx.destination);
  src.start();
}

function playBuiltinSound(sound: AgentDoneSound): void {
  const url = BUILTIN_URLS[sound];
  if (!url) return;
  playHtmlAudio(url, MAX_PLAY_SECONDS[sound]);
}

/**
 * Play the selected agent-done sound (bundled Mixkit samples or custom file).
 * No-ops for `none` or when audio is unavailable.
 */
export function playAgentDoneSound(sound: AgentDoneSound): void {
  if (sound === 'none') return;

  if (sound === 'custom') {
    const ctx = audioContext();
    if (!ctx) return;
    const start = () => {
      void playCustomSound(ctx).catch(() => {
        /* decode / missing file — ignore */
      });
    };
    if (ctx.state === 'suspended') {
      void ctx.resume().then(start).catch(() => {
        /* autoplay policy — ignore */
      });
    } else {
      start();
    }
    return;
  }

  playBuiltinSound(sound);
}
