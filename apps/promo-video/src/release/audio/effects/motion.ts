/**
 * The release film's motion sounds, each a mono voice: the selection's filtered sweep, camera and
 * wipe whooshes, the island's bloom, a glint's shimmer, the version's slam and the mosaic's tile
 * flips. Lengths are in seconds so each sound spans the move it follows.
 */
import {
  filter,
  midiToHz,
  noise,
  oscillator,
  SAMPLE_RATE,
  samples,
  shape,
} from '../../../audio/dsp.ts';
import { grain } from './ui.ts';

/** A smooth rise and fall over a span, peaking at `peak` (0–1 of the way through). */
function arch(seconds: number, peak: number): (t: number) => number {
  return (t) => {
    const p = Math.min(1, Math.max(0, t / seconds));
    return p < peak
      ? Math.sin((Math.PI / 2) * (p / peak))
      : Math.cos((Math.PI / 2) * ((p - peak) / (1 - peak)));
  };
}

/**
 * The selection's sweep: noise through a resonant band-pass gliding from `from` to `to` Hz over
 * the drag, warm rather than hissy, swelling and easing off as the selection settles.
 */
export function sweep(seconds: number, random: () => number, from = 500, to = 3200): Float32Array {
  const out = filter(
    noise(seconds, random),
    'bandpass',
    (t) => from * (to / from) ** Math.min(1, t / seconds),
    3,
  );
  filter(out, 'lowpass', 5000);
  return shape(out, arch(seconds, 0.7));
}

/** A whoosh: low-passed noise whose cutoff rises (`up`) or falls, swelling through the move. */
export function whoosh(seconds: number, random: () => number, up = true): Float32Array {
  const [from, to] = up ? [400, 4200] : [3600, 300];
  const out = filter(
    noise(seconds, random),
    'lowpass',
    (t) => from * (to / from) ** Math.min(1, t / seconds),
    1.1,
  );
  filter(out, 'highpass', 120);
  return shape(out, arch(seconds, up ? 0.75 : 0.35));
}

/**
 * A bloom as the island or a card lands: a soft low fifth on `root` swelling in 30 ms and fading
 * over `seconds`, with a breath of air on top. Larger `size` blooms lower and longer.
 */
export function bloom(root: number, random: () => number, size = 1): Float32Array {
  const seconds = 0.6 * size;
  const out = new Float32Array(samples(seconds));
  for (const [interval, gain] of [
    [0, 1],
    [7, 0.6],
    [12, 0.25],
  ] as const) {
    const voice = oscillator('sine', midiToHz(root + interval), seconds, random());
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (voice[i] ?? 0) * gain;
  }
  const air = filter(noise(seconds, random), 'bandpass', 2400, 0.8);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + 0.25 * (air[i] ?? 0);
  return shape(out, (t) => Math.min(1, t / 0.03) * Math.exp(-t / (0.16 * size)));
}

/**
 * A glint's shimmer: grains rising through `notes` over `seconds`, a little denser toward the
 * end, as light crossing glass.
 */
export function shimmer(
  seconds: number,
  random: () => number,
  notes: readonly number[],
): Float32Array {
  const out = new Float32Array(samples(seconds + 0.15));
  const count = Math.max(4, Math.round(seconds / 0.03));
  for (let index = 0; index < count; index++) {
    const p = index / (count - 1);
    const note = notes[Math.min(notes.length - 1, Math.floor(p * notes.length))] ?? 88;
    const voice = grain(note, random);
    const offset = Math.round(seconds * p ** 0.8 * SAMPLE_RATE);
    const gain = 0.4 + 0.6 * Math.sin(Math.PI * p);
    for (let i = 0; i < voice.length && offset + i < out.length; i++) {
      out[offset + i] = (out[offset + i] ?? 0) + (voice[i] ?? 0) * gain;
    }
  }
  return out;
}

/** A slam, lighter than the score's hit: a short low punch with a crack, for a word landing hard. */
export function slam(random: () => number): Float32Array {
  const body = oscillator('sine', (t) => 55 + 110 * Math.exp(-t / 0.02), 0.35);
  shape(body, (t) => Math.exp(-t / 0.09) * Math.min(1, t / 0.0015));
  const crack = shape(filter(noise(0.1, random), 'bandpass', 2000, 0.7), (t) =>
    Math.exp(-t / 0.012),
  );
  for (let i = 0; i < crack.length; i++) body[i] = (body[i] ?? 0) + 0.6 * (crack[i] ?? 0);
  return body;
}

/**
 * A tile flipping open: two quick flicks of bright noise. `heavy` adds a low body for the hero
 * tiles that land with a word.
 */
export function flip(random: () => number, heavy = false): Float32Array {
  const out = new Float32Array(samples(heavy ? 0.2 : 0.06));
  for (const [at, hz] of [
    [0, 2800],
    [0.012, 3900],
  ] as const) {
    const flick = shape(filter(noise(0.03, random), 'bandpass', hz, 1.8), (t) =>
      Math.exp(-t / 0.004),
    );
    const offset = Math.round(at * SAMPLE_RATE);
    for (let i = 0; i < flick.length && offset + i < out.length; i++) {
      out[offset + i] = (out[offset + i] ?? 0) + (flick[i] ?? 0);
    }
  }
  if (heavy) {
    const body = oscillator('sine', (t) => 90 + 80 * Math.exp(-t / 0.015), 0.2);
    shape(body, (t) => Math.exp(-t / 0.045));
    for (let i = 0; i < body.length; i++) out[i] = (out[i] ?? 0) + 0.8 * (body[i] ?? 0);
  }
  return out;
}
