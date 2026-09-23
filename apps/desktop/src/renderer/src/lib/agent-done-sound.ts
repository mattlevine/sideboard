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

function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < frames; i++) {
    const white = Math.random() * 2 - 1;
    // Brown-ish noise reads more like a dense crowd than white noise.
    brown = (brown + white * 0.02) * 0.996;
    data[i] = brown * 3.5 + white * 0.15;
  }
  return buffer;
}

function playNoiseLayer(
  ctx: AudioContext,
  master: AudioNode,
  buffer: AudioBuffer,
  t0: number,
  opts: {
    type: BiquadFilterType;
    freq: number;
    q: number;
    peak: number;
    attack: number;
    hold: number;
    release: number;
    freqEnd?: number;
  },
): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.setValueAtTime(opts.freq, t0);
  if (opts.freqEnd != null) {
    filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.attack + opts.hold);
  }
  filter.Q.setValueAtTime(opts.q, t0);
  const g = ctx.createGain();
  const end = t0 + opts.attack + opts.hold + opts.release;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.peak), t0 + opts.attack);
  g.gain.setValueAtTime(opts.peak * 0.85, t0 + opts.attack + opts.hold);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(end + 0.05);
}

/** Net thud + stadium surge (bass roar, mid cheer, high screams). */
function playStadiumCrowd(ctx: AudioContext, master: GainNode, t0: number): void {
  const buffer = makeNoiseBuffer(ctx, 2.8);

  // Ball hitting the net.
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(90, t0);
  thud.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, t0);
  tg.gain.exponentialRampToValueAtTime(0.55, t0 + 0.012);
  tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
  thud.connect(tg);
  tg.connect(master);
  thud.start(t0);
  thud.stop(t0 + 0.3);

  // Low stadium roar
  playNoiseLayer(ctx, master, buffer, t0, {
    type: 'lowpass',
    freq: 420,
    q: 0.5,
    peak: 0.55,
    attack: 0.04,
    hold: 0.9,
    release: 1.5,
  });
  // Mid cheer body
  playNoiseLayer(ctx, master, buffer, t0 + 0.02, {
    type: 'bandpass',
    freq: 1100,
    q: 0.55,
    peak: 0.4,
    attack: 0.05,
    hold: 0.85,
    release: 1.4,
    freqEnd: 1400,
  });
  // High screams / whistles in the stands
  playNoiseLayer(ctx, master, buffer, t0 + 0.05, {
    type: 'bandpass',
    freq: 2800,
    q: 0.9,
    peak: 0.22,
    attack: 0.08,
    hold: 0.7,
    release: 1.2,
    freqEnd: 3400,
  });
}

/**
 * Commentator-style “GOOOOAL” — rising then held vowel with formants + vibrato.
 * This is the recognisable cue; crowd alone reads as generic noise.
 */
function playGooaalShout(ctx: AudioContext, master: GainNode, t0: number): void {
  const start = t0 + 0.08;
  const rise = 0.45;
  const hold = 1.35;
  const fade = 0.55;
  const end = start + rise + hold + fade;

  // Source: slightly detuned saws → less “synth lead”, more throaty yell.
  const mix = ctx.createGain();
  mix.gain.setValueAtTime(1, start);

  for (const [detune, level] of [
    [0, 0.55],
    [7, 0.35],
    [-9, 0.28],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.setValueAtTime(detune, start);
    // “GO—” low → “—OAL” up and held (broadcast commentator shape).
    osc.frequency.setValueAtTime(165, start);
    osc.frequency.exponentialRampToValueAtTime(390, start + rise);
    osc.frequency.setValueAtTime(390, start + rise + hold * 0.7);
    osc.frequency.linearRampToValueAtTime(360, start + rise + hold);

    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime(5.2, start);
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.setValueAtTime(0, start);
    vibratoGain.gain.linearRampToValueAtTime(14, start + rise);
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(level, start);
    osc.connect(g);
    g.connect(mix);
    osc.start(start);
    osc.stop(end + 0.02);
    vibrato.start(start);
    vibrato.stop(end + 0.02);
  }

  // Open-vowel formants (approx “ah/oo” yell).
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.setValueAtTime(520, start);
  f1.frequency.linearRampToValueAtTime(680, start + rise);
  f1.Q.setValueAtTime(5, start);
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.setValueAtTime(1050, start);
  f2.frequency.linearRampToValueAtTime(1280, start + rise);
  f2.Q.setValueAtTime(6, start);

  const formantMix = ctx.createGain();
  formantMix.gain.setValueAtTime(0.9, start);

  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.setValueAtTime(1800, start);
  body.frequency.linearRampToValueAtTime(2600, start + rise);

  const shoutGain = ctx.createGain();
  shoutGain.gain.setValueAtTime(0.0001, start);
  shoutGain.gain.exponentialRampToValueAtTime(0.42, start + 0.06);
  shoutGain.gain.setValueAtTime(0.38, start + rise + hold * 0.5);
  shoutGain.gain.exponentialRampToValueAtTime(0.0001, end);

  // Soft slapback so it sits in a stadium, not dry headphones.
  const delay = ctx.createDelay(0.4);
  delay.delayTime.setValueAtTime(0.11, start);
  const delayGain = ctx.createGain();
  delayGain.gain.setValueAtTime(0.22, start);
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = 'lowpass';
  delayFilter.frequency.setValueAtTime(2200, start);

  mix.connect(body);
  body.connect(f1);
  body.connect(f2);
  f1.connect(formantMix);
  f2.connect(formantMix);
  formantMix.connect(shoutGain);
  shoutGain.connect(master);
  shoutGain.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayGain);
  delayGain.connect(master);
}

/** Two short stadium air-horn hits under the cheer. */
function playStadiumHorns(ctx: AudioContext, master: GainNode, t0: number): void {
  for (const [offset, freq, peak] of [
    [0.12, 370, 0.12],
    [0.38, 392, 0.1],
  ] as const) {
    const start = t0 + offset;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, start);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 2, start);
    filter.Q.setValueAtTime(2.5, start);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    osc.connect(filter);
    filter.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + 0.32);
  }
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
    master.gain.setValueAtTime(0.9, t0);
    master.connect(ctx.destination);

    if (sound === 'goal') {
      playStadiumCrowd(ctx, master, t0);
      playStadiumHorns(ctx, master, t0);
      playGooaalShout(ctx, master, t0);
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
