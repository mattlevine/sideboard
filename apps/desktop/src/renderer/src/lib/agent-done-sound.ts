import type { AgentDoneSound } from '@sideboard-ai/core';

/** Runtime guard — keep out of `@sideboard-ai/core` barrel imports in the renderer. */
export function isAgentDoneSound(value: unknown): value is AgentDoneSound {
  return (
    value === 'none' || value === 'goal' || value === 'bell' || value === 'train'
  );
}

/** Labels for Settings → Advanced → Agent done sound. */
export const AGENT_DONE_SOUND_OPTIONS: ReadonlyArray<{
  value: AgentDoneSound;
  label: string;
}> = [
  { value: 'none', label: 'Off' },
  { value: 'goal', label: 'Soccer goal' },
  { value: 'bell', label: 'Bell' },
  { value: 'train', label: 'Train whistle' },
];

let sharedCtx: AudioContext | null = null;

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

function now(ctx: AudioContext): number {
  return ctx.currentTime;
}

function gainAt(
  ctx: AudioContext,
  destination: AudioNode,
  peak: number,
  t0: number,
  attack: number,
  release: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
  g.connect(destination);
  return g;
}

/** Filtered noise burst — crowd-like roar under the goal celebration. */
function playCrowd(ctx: AudioContext, master: GainNode, t0: number): void {
  const seconds = 1.6;
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let prev = 0;
  for (let i = 0; i < frames; i++) {
    const white = Math.random() * 2 - 1;
    // Light low-pass for “crowd” texture.
    prev = prev * 0.92 + white * 0.08;
    data[i] = prev;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(900, t0);
  filter.Q.setValueAtTime(0.7, t0);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.35, t0 + 0.08);
  g.gain.setValueAtTime(0.28, t0 + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + seconds + 0.05);
}

/** Rising “goooal” pitch sweep + short whistle chirp. */
function playGoalMelody(ctx: AudioContext, master: GainNode, t0: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.85);
  const g = gainAt(ctx, master, 0.18, t0, 0.04, 0.95);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200, t0);
  filter.frequency.exponentialRampToValueAtTime(3200, t0 + 0.7);
  osc.connect(filter);
  filter.connect(g);
  osc.start(t0);
  osc.stop(t0 + 1.05);

  // Referee-style chirp at the peak.
  const whistle = ctx.createOscillator();
  whistle.type = 'sine';
  whistle.frequency.setValueAtTime(1800, t0 + 0.7);
  whistle.frequency.linearRampToValueAtTime(2400, t0 + 0.85);
  whistle.frequency.linearRampToValueAtTime(1900, t0 + 1.0);
  const wg = gainAt(ctx, master, 0.12, t0 + 0.7, 0.02, 0.35);
  whistle.connect(wg);
  whistle.start(t0 + 0.7);
  whistle.stop(t0 + 1.15);
}

function playBell(ctx: AudioContext, master: GainNode, t0: number): void {
  const partials: Array<[number, number]> = [
    [523.25, 0.22], // C5
    [1046.5, 0.12],
    [1569.75, 0.06],
    [2093, 0.04],
  ];
  for (const [freq, peak] of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    const g = gainAt(ctx, master, peak, t0, 0.005, 1.4);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + 1.6);
  }
}

function playTrainWhistle(ctx: AudioContext, master: GainNode, t0: number): void {
  const tones = [440, 554.37]; // A4 + C#5 — classic dual-tone whistle
  for (const freq of tones) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    // Slight vibrato.
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(5.5, t0);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(8, t0);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.08);
    g.gain.setValueAtTime(0.14, t0 + 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.35);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + 1.4);
    lfo.start(t0);
    lfo.stop(t0 + 1.4);
  }
}

/**
 * Play the selected agent-done sound via Web Audio.
 * No-ops for `none` or when AudioContext is unavailable.
 */
export function playAgentDoneSound(sound: AgentDoneSound): void {
  if (sound === 'none') return;
  const ctx = audioContext();
  if (!ctx) return;

  const start = () => {
    const t0 = now(ctx);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.85, t0);
    master.connect(ctx.destination);

    if (sound === 'goal') {
      playCrowd(ctx, master, t0);
      playGoalMelody(ctx, master, t0);
    } else if (sound === 'bell') {
      playBell(ctx, master, t0);
    } else if (sound === 'train') {
      playTrainWhistle(ctx, master, t0);
    }
  };

  if (ctx.state === 'suspended') {
    void ctx.resume().then(start).catch(() => {
      /* autoplay policy — ignore */
    });
  } else {
    start();
  }
}
