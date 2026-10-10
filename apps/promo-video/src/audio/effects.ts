/**
 * The interface's sound effects, each a short mono voice: keys, pops, snaps, swooshes, tine
 * cascades, a shutter and the display's power-on. They are small and soft: the interface should sound tactile, not loud.
 */
import {
  filter,
  midiToHz,
  mixInto as add,
  noise,
  oscillator,
  pluckEnvelope,
  SAMPLE_RATE,
  samples,
  shape,
} from './dsp.ts';

const TAU = Math.PI * 2;

/** A light keyboard tick: a bright click over a small thock. `pitch` varies it per key. */
export function keyTick(random: () => number, pitch = 1): Float32Array {
  const click = shape(filter(noise(0.02, random), 'bandpass', 3800 * pitch, 1.1), (t) =>
    Math.exp(-t / 0.0016),
  );
  const thock = shape(oscillator('sine', 210 * pitch, 0.06), (t) => Math.exp(-t / 0.014));
  return add(add(new Float32Array(samples(0.06)), click, 0, 0.9), thock, 0, 0.5);
}

/** A keycap pressed and let go: a deeper thock with its release a beat later. */
export function keyPress(random: () => number): Float32Array {
  const out = new Float32Array(samples(0.2));
  const down = shape(filter(noise(0.03, random), 'bandpass', 2300, 1), (t) => Math.exp(-t / 0.003));
  const body = shape(
    oscillator('sine', (t) => 150 - 40 * t, 0.12),
    (t) => Math.exp(-t / 0.03),
  );
  const up = shape(filter(noise(0.02, random), 'bandpass', 3400, 1.2), (t) => Math.exp(-t / 0.002));
  return add(add(add(out, down, 0, 0.9), body, 0, 0.7), up, 0.085, 0.35);
}

/** A soft pop: a sine that bends up as it decays, with a tiny click on the attack. */
export function pop(note: number, random: () => number): Float32Array {
  const hz = midiToHz(note);
  const body = shape(
    oscillator('sine', (t) => hz * (0.72 + 0.43 * (1 - Math.exp(-t / 0.018))), 0.16),
    (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.045),
  );
  const tick = shape(filter(noise(0.01, random), 'highpass', 5000), (t) => Math.exp(-t / 0.0012));
  return add(body, tick, 0, 0.25);
}

/** Moving air: noise through a band-pass sweeping up or down, swelling and fading over `seconds`. */
export function swoosh(
  random: () => number,
  seconds: number,
  from: number,
  to: number,
): Float32Array {
  const out = filter(
    noise(seconds, random),
    'bandpass',
    (t) => from * (to / from) ** (t / seconds),
    1.3,
  );
  return shape(out, (t) => Math.sin((Math.PI * t) / seconds) ** 1.6);
}

/** D major pentatonic over two and a half octaves: notes the score's harmony never fights. */
export const PENTATONIC = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86, 88, 90, 93];

/**
 * A kalimba tine: a pure note under a bright, inharmonic partial that dies within a few
 * milliseconds, as a plucked metal tongue sounds.
 */
export function tine(note: number, brightness = 1): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(0.7));
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    out[i] =
      Math.sin(TAU * hz * t) +
      0.2 * Math.sin(TAU * 2 * hz * t) * Math.exp(-t / 0.07) +
      0.45 * brightness * Math.sin(TAU * 5.4 * hz * t) * Math.exp(-t / 0.008);
  }
  return shape(out, pluckEnvelope(0.0015, 0.17));
}

/**
 * A run of `count` kalimba tines over `seconds`, stepping down (or up) the D major pentatonic from
 * `from`: each note a little softer, the run quickening as it goes, so dots scattering or a ring
 * lighting sound in tune with the music.
 */
export function cascade(
  random: () => number,
  count: number,
  seconds: number,
  from: number,
  direction: 'down' | 'up' = 'down',
): Float32Array {
  const out = new Float32Array(samples(seconds + 0.7));
  const start = Math.max(
    0,
    PENTATONIC.findIndex((note) => note >= from),
  );
  const step = direction === 'down' ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const index = Math.min(PENTATONIC.length - 1, Math.max(0, start + step * i));
    const note = PENTATONIC[index] ?? from;
    const at = count > 1 ? seconds * (i / (count - 1)) ** 0.85 : 0;
    const level = (1 - (0.45 * i) / count) * (0.85 + 0.15 * random());
    add(out, tine(note, level), at + 0.004 * random(), level);
  }
  return out;
}

/** A camera shutter: two clicks a breath apart with a short mechanical whir between. */
export function shutter(random: () => number): Float32Array {
  const out = new Float32Array(samples(0.25));
  const click = () =>
    shape(filter(noise(0.03, random), 'bandpass', 2600, 1.4), (t) => Math.exp(-t / 0.004));
  const whir = shape(filter(noise(0.08, random), 'bandpass', 900, 2), (t) =>
    Math.sin((Math.PI * t) / 0.08),
  );
  return add(add(add(out, click(), 0, 1), whir, 0.012, 0.35), click(), 0.075, 0.8);
}

/** The display waking: a rising tone that blooms into a shimmer, with air sweeping up beneath. */
export function powerOn(random: () => number, seconds = 1.5): Float32Array {
  const out = new Float32Array(samples(seconds + 0.6));
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const rise = Math.min(1, t / seconds);
    const hz = 180 * 4 ** rise;
    const swell = Math.sin(Math.PI * Math.min(1, t / (seconds + 0.6))) ** 1.5;
    const shimmer = Math.sin(TAU * hz * 2 * t + 1.2 * Math.sin(TAU * hz * 3.01 * t));
    out[i] = (Math.sin(TAU * hz * t) * 0.6 + shimmer * 0.25 * rise) * swell;
  }
  return add(out, swoosh(random, seconds, 300, 5200), 0, 0.5);
}

/** A struck glass note for the name lighting up: two pure partials with a long, soft ring. */
export function glass(note: number): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(2.5));
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    out[i] = Math.sin(TAU * hz * t) + 0.35 * Math.sin(TAU * hz * 2.76 * t) * Math.exp(-t / 0.4);
  }
  return shape(out, pluckEnvelope(0.003, 0.7));
}

/** A mouse click: one crisp, short tick. */
export function mouseClick(random: () => number): Float32Array {
  return shape(filter(noise(0.025, random), 'bandpass', 4200, 1.6), (t) => Math.exp(-t / 0.0022));
}

/** The smallest interface sound: a bright blip a few milliseconds long, for snaps and streaming text. */
export function snap(random: () => number, pitch = 1): Float32Array {
  const blip = shape(oscillator('sine', 2600 * pitch, 0.02), (t) => Math.exp(-t / 0.0035));
  const edge = shape(filter(noise(0.01, random), 'highpass', 6000), (t) => Math.exp(-t / 0.001));
  return add(blip, edge, 0, 0.3);
}

/** Something soft landing: a low body that falls in pitch under a dull, felted contact. */
export function thud(random: () => number): Float32Array {
  const body = shape(
    oscillator('sine', (t) => 58 + 70 * Math.exp(-t / 0.03), 0.3),
    (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.07),
  );
  const contact = shape(filter(noise(0.06, random), 'lowpass', 900, 0.8), (t) =>
    Math.exp(-t / 0.01),
  );
  return add(body, contact, 0, 0.6);
}
