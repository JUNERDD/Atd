/**
 * Effects with weight and material: the macro keycaps, cards slamming in, the mini panel's liquid
 * stretch and squash, a window springing open, the night's clock and the screen freezing. Each is a
 * short mono voice; levels are left to the cues.
 */
import {
  filter,
  midiToHz,
  mixInto as add,
  noise,
  oscillator,
  pluckEnvelope,
  samples,
  shape,
} from './dsp.ts';

const TAU = Math.PI * 2;

/** Soft saturation, normalized so a full-scale sine stays at full scale. */
function warm(voice: Float32Array, drive: number): Float32Array {
  const norm = Math.tanh(drive);
  for (let i = 0; i < voice.length; i++) voice[i] = Math.tanh(drive * (voice[i] ?? 0)) / norm;
  return voice;
}

/**
 * A large macro keycap pressed and let go: the plastic click, a hollow body that drops in pitch,
 * the stem bottoming out, then the lighter release. `size` above 1 is a bigger, deeper key.
 */
export function macroKey(random: () => number, size = 1): Float32Array {
  const out = new Float32Array(samples(0.5 * size));
  const click = shape(filter(noise(0.03, random), 'bandpass', 2400 / size, 1.2), (t) =>
    Math.exp(-t / 0.0035),
  );
  const body = warm(
    shape(
      oscillator('sine', (t) => (92 + 75 * Math.exp(-t / 0.02)) / size, 0.32),
      (t) => Math.min(1, t / 0.002) * Math.exp(-t / (0.05 * size)),
    ),
    1.6,
  );
  const cavity = shape(oscillator('sine', 420 / size, 0.1), (t) => Math.exp(-t / 0.016));
  const bottom = shape(filter(noise(0.05, random), 'lowpass', 750, 0.9), (t) =>
    Math.exp(-t / 0.011),
  );
  const release = 0.14 * size;
  const up = shape(filter(noise(0.02, random), 'bandpass', 3300 / size, 1.4), (t) =>
    Math.exp(-t / 0.0025),
  );
  const upBody = shape(oscillator('sine', 190 / size, 0.08), (t) => Math.exp(-t / 0.014));
  add(out, click, 0, 0.75);
  add(out, body, 0, 0.9);
  add(out, cavity, 0.001, 0.22);
  add(out, bottom, 0.006, 0.55);
  add(out, up, release, 0.32);
  return add(out, upBody, release, 0.22);
}

/**
 * A card slamming into place: a low thump and a dull hit under a short pitched body, so a run of
 * slams can climb a scale.
 */
export function slam(random: () => number, note: number): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(0.6));
  const thump = warm(
    shape(
      oscillator('sine', (t) => 48 + 95 * Math.exp(-t / 0.024), 0.45),
      (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.085),
    ),
    1.8,
  );
  const hit = shape(filter(noise(0.08, random), 'lowpass', 3400, 0.8), (t) => Math.exp(-t / 0.011));
  const tone = shape(
    oscillator('sine', (t) => hz * (0.95 + 0.05 * (1 - Math.exp(-t / 0.02))), 0.55),
    pluckEnvelope(0.002, 0.11),
  );
  const overtone = shape(oscillator('sine', hz * 2.01, 0.3), pluckEnvelope(0.002, 0.04));
  add(out, thump, 0, 0.8);
  add(out, hit, 0, 0.45);
  add(out, tone, 0.002, 0.5);
  return add(out, overtone, 0.002, 0.18);
}

/**
 * The mini panel reaching for a file like liquid: a soft tone sliding up under a resonant low-pass
 * that opens and partly closes again, with wet noise moving through the same band.
 */
export function stretch(random: () => number, seconds: number): Float32Array {
  const progress = (t: number) => Math.min(1, t / seconds);
  const tone = filter(
    oscillator('saw', (t) => 120 * 2 ** (0.8 * progress(t)), seconds),
    'lowpass',
    (t) => 260 * 9 ** Math.sin((Math.PI / 2) * progress(t) ** 0.8),
    4.5,
  );
  const wet = filter(
    noise(seconds, random),
    'bandpass',
    (t) => 500 * 5 ** Math.sin((Math.PI / 2) * progress(t)),
    3.5,
  );
  const out = add(add(new Float32Array(samples(seconds)), tone, 0, 0.5), wet, 0, 0.35);
  return shape(out, (t) => Math.min(1, t / 0.08) * Math.sin(Math.PI * progress(t)) ** 0.6);
}

/** A soft bloop bending down as something collapses, wobbling twice as it settles. */
export function squash(random: () => number): Float32Array {
  const body = shape(
    oscillator('sine', (t) => 120 + 260 * Math.exp(-t / 0.05), 0.35),
    (t) =>
      Math.min(1, t / 0.003) *
      Math.exp(-t / 0.065) *
      (1 + 0.35 * Math.sin(TAU * 15 * t) * Math.exp(-t / 0.09)),
  );
  const contact = shape(filter(noise(0.04, random), 'lowpass', 1200, 0.8), (t) =>
    Math.exp(-t / 0.008),
  );
  return add(body, contact, 0, 0.3);
}

/** A window springing open: a pure note that overshoots its pitch and wobbles as it settles. */
export function spring(random: () => number, note: number): Float32Array {
  const hz = midiToHz(note);
  const body = shape(
    oscillator(
      'sine',
      (t) =>
        hz *
        (0.86 + 0.14 * (1 - Math.exp(-t / 0.03))) *
        (1 + 0.045 * Math.sin(TAU * 11 * t) * Math.exp(-t / 0.14)),
      0.7,
    ),
    pluckEnvelope(0.004, 0.14),
  );
  const tick = shape(filter(noise(0.01, random), 'highpass', 4500), (t) => Math.exp(-t / 0.0015));
  return add(body, tick, 0, 0.2);
}

/** One tick of a clock: a small wooden knock; `tock` sounds the lower of the pair. */
export function clockTick(random: () => number, tock = false): Float32Array {
  const pitch = tock ? 0.82 : 1;
  const wood = shape(filter(noise(0.03, random), 'bandpass', 2700 * pitch, 5), (t) =>
    Math.exp(-t / 0.006),
  );
  const tone = shape(oscillator('sine', 1850 * pitch, 0.03), (t) => Math.exp(-t / 0.006));
  return add(add(new Float32Array(samples(0.03)), wood, 0, 2.4), tone, 0, 0.5);
}

/**
 * The screen freezing for a screenshot: a glint, then air whose brightness drains away as a low
 * tone sinks under it, like the room going muffled.
 */
export function freeze(random: () => number): Float32Array {
  const seconds = 0.9;
  const air = shape(
    filter(
      noise(seconds, random),
      'lowpass',
      (t) => 3400 * (240 / 3400) ** Math.min(1, t / 0.45),
      1.1,
    ),
    (t) => Math.min(1, t / 0.025) * Math.exp(-t / 0.22),
  );
  const sink = shape(
    oscillator('sine', (t) => 55 + 170 * Math.exp(-t / 0.11), seconds),
    (t) => Math.min(1, t / 0.006) * Math.exp(-t / 0.2),
  );
  const glint = shape(filter(noise(0.08, random), 'highpass', 6500), (t) => Math.exp(-t / 0.014));
  const out = add(new Float32Array(samples(seconds)), air, 0, 0.8);
  return add(add(out, sink, 0, 0.5), glint, 0, 0.18);
}
