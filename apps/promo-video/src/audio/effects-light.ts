/**
 * Effects for the film's light: a bloom swelling up, drops of light gliding in, the shimmer that
 * glints along the mark, water-drop plips for files landing, and the display dimming. All tonal
 * parts stay on D major pentatonic notes, so they ring with the score instead of against it.
 */
import {
  filter,
  midiToHz,
  mixInto as add,
  noise,
  oscillator,
  SAMPLE_RATE,
  samples,
  shape,
} from './dsp.ts';
import { swoosh } from './effects.ts';

const TAU = Math.PI * 2;

/** The high D major pentatonic the shimmer draws from. */
const SPARKLE_NOTES = [86, 88, 90, 93, 95, 98, 100];

/**
 * Light blooming out from under a key: air that opens upward, and a glassy halo of D, A and the
 * upper D fading in with it and lingering.
 */
export function bloom(random: () => number, seconds = 1.6): Float32Array {
  const length = seconds + 1.2;
  const peak = seconds * 0.35;
  const air = shape(
    filter(
      noise(length, random),
      'bandpass',
      (t) => 220 * (3600 / 220) ** Math.min(1, t / seconds),
      0.9,
    ),
    (t) => Math.min(1, t / peak) ** 1.5 * Math.exp(-Math.max(0, t - peak) / (seconds * 0.45)),
  );
  const out = add(new Float32Array(samples(length)), air, 0, 0.7);
  for (const [index, [note, level]] of [
    [74, 1],
    [81, 0.7],
    [86, 0.45],
  ].entries()) {
    const hz = midiToHz(note ?? 74);
    const halo = new Float32Array(samples(length));
    for (let i = 0; i < halo.length; i++) {
      const t = i / SAMPLE_RATE;
      const swell = Math.min(1, t / (0.25 + 0.1 * index)) * Math.exp(-t / (seconds * 0.6));
      halo[i] = Math.sin(TAU * hz * t + 0.3 * Math.sin(TAU * 0.7 * t)) * swell;
    }
    add(out, halo, 0, 0.22 * (level ?? 1));
  }
  return out;
}

/**
 * A drop of light travelling in: a pure tone gliding from `from` to `to` on an ease-out curve,
 * with a faint shimmer partial and breath, swelling as it nears and easing off as it arrives, so
 * whatever sounds the arrival stands out.
 */
export function dropGlide(
  random: () => number,
  seconds: number,
  from: number,
  to: number,
): Float32Array {
  const f0 = midiToHz(from);
  const f1 = midiToHz(to);
  const ease = (t: number) => 1 - (1 - Math.min(1, t / seconds)) ** 3;
  const hz = (t: number) => f0 * (f1 / f0) ** ease(t);
  const length = seconds + 0.5;
  const tone = oscillator('sine', hz, length);
  const shimmer = oscillator('sine', (t) => hz(t) * 3, length, 0.25);
  const breath = filter(noise(length, random), 'bandpass', (t) => hz(t) * 4, 3);
  const out = add(add(new Float32Array(samples(length)), tone, 0, 1), breath, 0, 0.5);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    out[i] = (out[i] ?? 0) + 0.12 * (shimmer[i] ?? 0) * (0.5 + 0.5 * Math.sin(TAU * 9 * t));
  }
  const arrival = 0.55;
  return shape(out, (t) => {
    const p = t / seconds;
    return t < seconds
      ? 0.15 + 0.85 * p ** 1.5 * (1 - (1 - arrival) * p ** 6)
      : arrival * Math.exp(-(t - seconds) / 0.1);
  });
}

/**
 * A shimmer: tiny high grains of the pentatonic scattered over `seconds`, thickest at the start,
 * like a glint running along an edge.
 */
export function sparkle(random: () => number, seconds: number, grains = 24): Float32Array {
  const out = new Float32Array(samples(seconds + 0.3));
  for (let g = 0; g < grains; g++) {
    const at = seconds * random() ** 1.6;
    const note = SPARKLE_NOTES[Math.floor(random() * SPARKLE_NOTES.length)] ?? 93;
    const decay = 0.04 + 0.08 * random();
    const grain = shape(
      oscillator('sine', midiToHz(note), decay * 5, random()),
      (t) => Math.min(1, t / 0.0015) * Math.exp(-t / decay),
    );
    add(out, grain, at, (1 - (0.7 * at) / seconds) * (0.5 + 0.5 * random()));
  }
  return out;
}

/** A water drop landing: a pitch that leaps up within milliseconds over a small, soft knock. */
export function droplet(random: () => number, note: number): Float32Array {
  const hz = midiToHz(note);
  const body = shape(
    oscillator('sine', (t) => hz * (1 + 0.85 * (1 - Math.exp(-t / 0.012))), 0.16),
    (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.032),
  );
  const knock = shape(
    oscillator('sine', (t) => 85 + 70 * Math.exp(-t / 0.015), 0.1),
    (t) => Math.exp(-t / 0.02),
  );
  const splash = shape(filter(noise(0.03, random), 'bandpass', 5200, 2), (t) =>
    Math.exp(-t / 0.004),
  );
  return add(add(body, knock, 0, 0.35), splash, 0, 0.1);
}

/** The display dimming to idle: a tone sinking by more than an octave as air drains downward. */
export function powerDown(random: () => number, seconds = 1): Float32Array {
  const tone = shape(
    oscillator('sine', (t) => 330 * 0.4 ** Math.min(1, t / seconds), seconds),
    (t) => Math.sin(Math.PI * Math.min(1, t / seconds)) ** 1.2,
  );
  return add(swoosh(random, seconds, 1600, 200), tone, 0, 0.4);
}
