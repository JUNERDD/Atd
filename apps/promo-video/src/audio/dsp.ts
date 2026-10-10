/**
 * The soundtrack's building blocks: buffers, oscillators, envelopes and filters. Everything is
 * deterministic (seeded noise, no clocks), so the same timeline always scores the same audio.
 */
export const SAMPLE_RATE = 48000;

export interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

export function stereo(seconds: number): Stereo {
  const length = Math.ceil(seconds * SAMPLE_RATE);
  return { left: new Float32Array(length), right: new Float32Array(length) };
}

export function samples(seconds: number): number {
  return Math.max(1, Math.round(seconds * SAMPLE_RATE));
}

/** A seeded uniform random source in [0, 1) (mulberry32). */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** Equal-power gains for a position from -1 (left) to 1 (right). */
export function panGains(position: number): [number, number] {
  const angle = ((position + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

/** Adds a mono voice into a stereo bus at `start` seconds. */
export function addMono(
  out: Stereo,
  voice: Float32Array,
  start: number,
  gain: number,
  position = 0,
): void {
  const [gl, gr] = panGains(position);
  const offset = Math.round(start * SAMPLE_RATE);
  const end = Math.min(voice.length, out.left.length - offset);
  for (let i = Math.max(0, -offset); i < end; i++) {
    const value = (voice[i] ?? 0) * gain;
    out.left[offset + i] = (out.left[offset + i] ?? 0) + value * gl;
    out.right[offset + i] = (out.right[offset + i] ?? 0) + value * gr;
  }
}

/** Mixes a mono voice into another at `at` seconds, scaled; for building one effect from parts. */
export function mixInto(into: Float32Array, voice: Float32Array, at = 0, gain = 1): Float32Array {
  const offset = Math.round(at * SAMPLE_RATE);
  for (let i = 0; i < voice.length && offset + i < into.length; i++) {
    into[offset + i] = (into[offset + i] ?? 0) + (voice[i] ?? 0) * gain;
  }
  return into;
}

/**
 * Adds a mono voice that travels across the stereo field: `position(t)` gives its pan, -1 to 1,
 * `t` seconds into the voice.
 */
export function addMoving(
  out: Stereo,
  voice: Float32Array,
  start: number,
  gain: number,
  position: (t: number) => number,
): void {
  const offset = Math.round(start * SAMPLE_RATE);
  const end = Math.min(voice.length, out.left.length - offset);
  for (let i = Math.max(0, -offset); i < end; i++) {
    const [gl, gr] = panGains(Math.max(-1, Math.min(1, position(i / SAMPLE_RATE))));
    const value = (voice[i] ?? 0) * gain;
    out.left[offset + i] = (out.left[offset + i] ?? 0) + value * gl;
    out.right[offset + i] = (out.right[offset + i] ?? 0) + value * gr;
  }
}

/** Adds one stereo bus into another, scaled. */
export function addStereo(out: Stereo, bus: Stereo, gain = 1): void {
  for (let i = 0; i < out.left.length; i++) {
    out.left[i] = (out.left[i] ?? 0) + (bus.left[i] ?? 0) * gain;
    out.right[i] = (out.right[i] ?? 0) + (bus.right[i] ?? 0) * gain;
  }
}

/** A band-limited sawtooth step (polyBLEP), so bright waves do not alias. */
function blep(phase: number, step: number): number {
  if (phase < step) {
    const t = phase / step;
    return t + t - t * t - 1;
  }
  if (phase > 1 - step) {
    const t = (phase - 1) / step;
    return t * t + t + t + 1;
  }
  return 0;
}

export type Wave = 'sine' | 'saw' | 'triangle';

/**
 * An oscillator over `seconds`, its frequency fixed or following `glide(t)` (t in seconds), from
 * a starting phase in cycles.
 */
export function oscillator(
  wave: Wave,
  frequency: number | ((t: number) => number),
  seconds: number,
  phase0 = 0,
): Float32Array {
  const out = new Float32Array(samples(seconds));
  let phase = phase0 % 1;
  for (let i = 0; i < out.length; i++) {
    const hz = typeof frequency === 'number' ? frequency : frequency(i / SAMPLE_RATE);
    const step = hz / SAMPLE_RATE;
    if (wave === 'sine') out[i] = Math.sin(2 * Math.PI * phase);
    else if (wave === 'saw') out[i] = 2 * phase - 1 - blep(phase, step);
    else out[i] = 1 - 4 * Math.abs(phase - 0.5);
    phase += step;
    if (phase >= 1) phase -= 1;
  }
  return out;
}

export function noise(seconds: number, random: () => number): Float32Array {
  const out = new Float32Array(samples(seconds));
  for (let i = 0; i < out.length; i++) out[i] = random() * 2 - 1;
  return out;
}

/** Multiplies a voice by an envelope given as a function of seconds. */
export function shape(voice: Float32Array, envelope: (t: number) => number): Float32Array {
  for (let i = 0; i < voice.length; i++) voice[i] = (voice[i] ?? 0) * envelope(i / SAMPLE_RATE);
  return voice;
}

/** Attack, hold at full, then an exponential tail with time constant `decay`. */
export function pluckEnvelope(attack: number, decay: number): (t: number) => number {
  return (t) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));
}

/** Linear attack and release around a sustained level, over a known length. */
export function arEnvelope(length: number, attack: number, release: number): (t: number) => number {
  return (t) => Math.min(1, t / attack, Math.max(0, (length - t) / release));
}

type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'highshelf';

/** An RBJ-cookbook biquad. Coefficients can be retuned per sample for sweeps. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly kind: BiquadKind;

  constructor(kind: BiquadKind, frequency: number, q = Math.SQRT1_2, gainDb = 0) {
    this.kind = kind;
    this.tune(frequency, q, gainDb);
  }

  tune(frequency: number, q = Math.SQRT1_2, gainDb = 0): void {
    const w = (2 * Math.PI * Math.min(frequency, SAMPLE_RATE * 0.45)) / SAMPLE_RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    if (this.kind === 'highshelf') {
      const a = 10 ** (gainDb / 40);
      const root = 2 * Math.sqrt(a) * alpha;
      b0 = a * (a + 1 + (a - 1) * cos + root);
      b1 = -2 * a * (a - 1 + (a + 1) * cos);
      b2 = a * (a + 1 + (a - 1) * cos - root);
      a0 = a + 1 - (a - 1) * cos + root;
      a1 = 2 * (a - 1 - (a + 1) * cos);
      a2 = a + 1 - (a - 1) * cos - root;
    } else {
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      if (this.kind === 'lowpass') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
      else if (this.kind === 'highpass') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
      else [b0, b1, b2] = [alpha, 0, -alpha];
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Runs a voice through a filter whose cutoff may follow `cutoff(t)`. */
export function filter(
  voice: Float32Array,
  kind: BiquadKind,
  cutoff: number | ((t: number) => number),
  q = Math.SQRT1_2,
): Float32Array {
  const fixed = typeof cutoff === 'number';
  const biquad = new Biquad(kind, fixed ? cutoff : cutoff(0), q);
  for (let i = 0; i < voice.length; i++) {
    if (!fixed && i % 32 === 0) biquad.tune(cutoff(i / SAMPLE_RATE), q);
    voice[i] = biquad.process(voice[i] ?? 0);
  }
  return voice;
}
