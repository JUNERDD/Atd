/**
 * The release film's interface sounds, each a mono voice: a person's keystroke, the app's
 * write-back grain, the pointer's press and release, the macro keycaps, a glass pop for surfaces
 * that grow, a morph blip, the two-note chime and a settling thunk. Pitched voices take MIDI notes
 * so the cues can tune them to the score's key (C♯ minor → E major).
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

const TAU = Math.PI * 2;

/** Adds `part` into `into` scaled, sample for sample from the start. */
function layer(into: Float32Array, part: Float32Array, gain: number): Float32Array {
  for (let i = 0; i < part.length && i < into.length; i++) {
    into[i] = (into[i] ?? 0) + (part[i] ?? 0) * gain;
  }
  return into;
}

/**
 * A person's keystroke on a low-profile keyboard: a short woody body under a dry click. `pitch`
 * near 1 varies it key to key; a larger `weight` (Space, Return) sounds deeper.
 */
export function keystroke(random: () => number, pitch = 1, weight = 1): Float32Array {
  const body = oscillator(
    'sine',
    (t) => ((480 + 220 * Math.exp(-t / 0.004)) * pitch) / weight,
    0.05,
  );
  shape(body, (t) => Math.exp(-t / (0.007 * weight)));
  const click = filter(noise(0.03, random), 'bandpass', 2600 * pitch, 1.3);
  shape(click, (t) => Math.exp(-t / 0.0035));
  const thump = shape(oscillator('sine', 150 / weight, 0.05), (t) => Math.exp(-t / 0.012));
  return layer(
    layer(layer(new Float32Array(samples(0.05)), body, 0.5), click, 0.9),
    thump,
    0.35 * weight,
  );
}

/**
 * One grain of the app writing back: a bright sine with a quick FM sparkle, gone in 40 ms. A
 * stream of them, rising through a scale, is the write-back's glitter, lighter and faster than
 * anyone's typing.
 */
export function grain(note: number, random: () => number): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(0.12));
  const phase = random();
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const sparkle = 1.2 * Math.exp(-t / 0.006) * Math.sin(TAU * 3 * hz * t);
    out[i] = Math.sin(TAU * (hz * t + phase) + sparkle) * Math.exp(-t / 0.028);
  }
  const air = shape(filter(noise(0.01, random), 'highpass', 7000), (t) => Math.exp(-t / 0.002));
  return shape(layer(out, air, 0.25), (t) => Math.min(1, t / 0.0008));
}

/** The pointer's button: `down` is a firm click, `up` a lighter, higher one. */
export function press(random: () => number, kind: 'down' | 'up'): Float32Array {
  const up = kind === 'up';
  const snap = filter(noise(0.025, random), 'bandpass', up ? 5200 : 3900, 1.5);
  shape(snap, (t) => Math.exp(-t / (up ? 0.0018 : 0.0026)));
  const tone = shape(oscillator('sine', up ? 2900 : 2100, 0.025), (t) => Math.exp(-t / 0.004));
  return layer(snap, tone, up ? 0.25 : 0.4);
}

/** A click: press and release 45 ms apart. */
export function click(random: () => number): Float32Array {
  const out = new Float32Array(samples(0.08));
  layer(out, press(random, 'down'), 1);
  const up = press(random, 'up');
  const offset = Math.round(0.045 * SAMPLE_RATE);
  for (let i = 0; i < up.length && offset + i < out.length; i++) {
    out[offset + i] = (out[offset + i] ?? 0) + (up[i] ?? 0) * 0.55;
  }
  return out;
}

/**
 * A macro keycap, filling the frame: `press` is a deep thock with a bright edge, `release` the
 * spring's lighter clack. `size` above 1 is a wider key (Space), lower in pitch.
 */
export function keycap(random: () => number, kind: 'press' | 'release', size = 1): Float32Array {
  if (kind === 'release') {
    const clack = filter(noise(0.04, random), 'bandpass', 3400 / size, 1.4);
    shape(clack, (t) => Math.exp(-t / 0.004));
    const body = shape(oscillator('sine', 620 / size, 0.04), (t) => Math.exp(-t / 0.006));
    return layer(clack, body, 0.3);
  }
  const body = oscillator('sine', (t) => (120 + 140 * Math.exp(-t / 0.008)) / size, 0.16);
  shape(body, (t) => Math.exp(-t / 0.035) * Math.min(1, t / 0.001));
  const edge = filter(noise(0.04, random), 'bandpass', 2400 / size, 1.1);
  shape(edge, (t) => Math.exp(-t / 0.005));
  return layer(body, edge, 0.7);
}

/** A glass pop as a surface grows: a sine sliding up a fourth to `note`, with a bright tap. */
export function pop(note: number, random: () => number): Float32Array {
  const hz = midiToHz(note);
  const out = oscillator('sine', (t) => hz * 2 ** ((-5 * Math.exp(-t / 0.012)) / 12), 0.18);
  shape(out, (t) => Math.exp(-t / 0.05) * Math.min(1, t / 0.002));
  const tap = shape(filter(noise(0.02, random), 'bandpass', 3800, 2), (t) => Math.exp(-t / 0.003));
  return layer(out, tap, 0.5);
}

/** A morph blip: a soft triangle at `note` that slips down a tone as it fades. */
export function blip(note: number, fall = 2): Float32Array {
  const hz = midiToHz(note);
  const out = oscillator('triangle', (t) => hz * 2 ** ((-fall * Math.min(1, t / 0.06)) / 12), 0.1);
  return shape(out, (t) => Math.exp(-t / 0.03) * Math.min(1, t / 0.003));
}

/**
 * A chime of `notes` struck `gap` seconds apart: a sine with its octave and twelfth, ringing a
 * little under a second. Two notes rising a fourth onto the chord's root is "Written".
 */
export function chime(notes: readonly number[], gap = 0.09, ring = 0.55): Float32Array {
  const out = new Float32Array(samples(gap * notes.length + ring * 4));
  for (const [index, note] of notes.entries()) {
    const hz = midiToHz(note);
    const offset = Math.round(index * gap * SAMPLE_RATE);
    for (let i = 0; offset + i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const partials =
        Math.sin(TAU * hz * t) +
        0.3 * Math.sin(TAU * 2 * hz * t) * Math.exp(-t / 0.2) +
        0.12 * Math.sin(TAU * 3 * hz * t) * Math.exp(-t / 0.08);
      const envelope = Math.exp(-t / ring) * Math.min(1, t / 0.002);
      out[offset + i] = (out[offset + i] ?? 0) + partials * envelope * (index === 0 ? 0.8 : 1);
    }
  }
  return out;
}

/** A settling thunk: something set down in place (a dropped row, a decimal point landing). */
export function thunk(random: () => number, note = 45): Float32Array {
  const body = oscillator('sine', (t) => midiToHz(note) * (1 + 0.6 * Math.exp(-t / 0.01)), 0.2);
  shape(body, (t) => Math.exp(-t / 0.05) * Math.min(1, t / 0.001));
  const felt = shape(filter(noise(0.05, random), 'lowpass', 1800), (t) => Math.exp(-t / 0.008));
  return layer(body, felt, 0.6);
}
