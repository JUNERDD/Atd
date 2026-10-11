/**
 * The release score's drum kit, tighter and drier than the launch film's: a short round kick with
 * a pitch drop and a bright beater, a snare with a clap layered in, metallic hats built from six
 * square waves, a shaker, and the typing tick that turns keystrokes into a hat pattern. Each
 * returns a mono voice; levels are left to the score.
 */
import { filter, noise, oscillator, SAMPLE_RATE, samples, shape } from '../../../audio/dsp.ts';

const TAU = Math.PI * 2;

/** A kick: a sine falling from 175 to 46 Hz, softly saturated, with a short beater click. */
export function kick(random: () => number, weight = 1): Float32Array {
  const body = oscillator('sine', (t) => 46 + 129 * Math.exp(-t / 0.032), 0.5);
  shape(body, (t) => Math.exp(-t / (0.16 * weight)) * Math.min(1, t / 0.0015));
  for (let i = 0; i < body.length; i++) body[i] = Math.tanh(1.7 * (body[i] ?? 0)) / Math.tanh(1.7);
  const beater = filter(noise(0.01, random), 'bandpass', 4200, 1.1);
  shape(beater, (t) => Math.exp(-t / 0.0018));
  for (let i = 0; i < beater.length; i++) body[i] = (body[i] ?? 0) + 0.45 * (beater[i] ?? 0);
  return body;
}

/**
 * A snare with a clap in it: a short tuned body at 190 and 330 Hz, a band of bright noise for the
 * wires, and three quick bursts a few milliseconds apart that read as hands.
 */
export function snare(random: () => number): Float32Array {
  const length = 0.32;
  const out = new Float32Array(samples(length));
  const low = oscillator('sine', (t) => 190 + 40 * Math.exp(-t / 0.01), length);
  const high = oscillator('sine', 330, length);
  const wires = filter(noise(length, random), 'bandpass', 3100, 0.6);
  const hands = filter(noise(length, random), 'bandpass', 1500, 0.9);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const tone = ((low[i] ?? 0) + 0.5 * (high[i] ?? 0)) * Math.exp(-t / 0.045);
    const burst = [0, 0.008, 0.017].reduce(
      (sum, at) => sum + (t >= at ? Math.exp(-(t - at) / 0.004) : 0),
      0,
    );
    const clap = (hands[i] ?? 0) * (Math.min(1, burst) + 0.45 * Math.exp(-t / 0.07));
    out[i] = 0.55 * tone + 0.7 * (wires[i] ?? 0) * Math.exp(-t / 0.1) + 0.8 * clap;
  }
  return shape(out, (t) => Math.min(1, t / 0.0008));
}

/** The six inharmonic square partials of an analog cymbal circuit, in Hz. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

/** A metallic wash of six square waves, high-passed: the body of hats and the crash. */
function metal(seconds: number, random: () => number, cutoff: number): Float32Array {
  const out = new Float32Array(samples(seconds));
  const phases = METAL.map(() => random());
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    let sum = 0;
    for (const [index, hz] of METAL.entries()) {
      sum += Math.sin(TAU * (hz * t + (phases[index] ?? 0))) >= 0 ? 1 : -1;
    }
    out[i] = sum / METAL.length;
  }
  return filter(filter(out, 'highpass', cutoff, 1.2), 'highpass', cutoff, 0.7);
}

/** A hat: the metal wash and a little noise, closed (tight) or open (a short sizzle). */
export function hat(random: () => number, open = false): Float32Array {
  const decay = open ? 0.15 : 0.022;
  const seconds = decay * 6;
  const out = metal(seconds, random, 7200);
  const air = filter(noise(seconds, random), 'highpass', 9000, 0.7);
  for (let i = 0; i < out.length; i++) out[i] = 1.5 * (out[i] ?? 0) + 1.1 * (air[i] ?? 0);
  return shape(out, (t) => Math.exp(-t / decay) * Math.min(1, t / 0.0005));
}

/** A crash: the metal wash lower and longer, with bright noise blooming over a second and a half. */
export function crash(random: () => number): Float32Array {
  const seconds = 2.4;
  const out = metal(seconds, random, 4200);
  const air = filter(noise(seconds, random), 'highpass', 5500, 0.6);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (out[i] ?? 0) + 0.6 * (air[i] ?? 0);
  return shape(out, (t) => Math.exp(-t / 0.55) * Math.min(1, t / 0.002));
}

/** A shaker: a band of noise that swells in for 12 ms and falls away, softer than any hat. */
export function shaker(random: () => number): Float32Array {
  const out = filter(noise(0.12, random), 'bandpass', 6400, 1.3);
  return shape(out, (t) => (t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / 0.035)));
}

/**
 * A typing tick: the click of a low-profile key, a few milliseconds of bright noise over a tiny
 * blip. `pitch` near 1 varies it key to key; quantized to sixteenths it plays as a hat.
 */
export function tick(random: () => number, pitch = 1): Float32Array {
  const out = filter(noise(0.03, random), 'highpass', 4500 * pitch, 1);
  const blip = oscillator('sine', 2900 * pitch, 0.03);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    out[i] = (out[i] ?? 0) * Math.exp(-t / 0.0025) + 0.4 * (blip[i] ?? 0) * Math.exp(-t / 0.005);
  }
  return out;
}
