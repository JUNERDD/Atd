/**
 * The soundtrack's instruments, each rendering one note as a mono voice: a warm pad, an FM pluck,
 * a struck bell, a sub bass and a soft kit. Levels are left to the score.
 */
import {
  arEnvelope,
  filter,
  midiToHz,
  noise,
  oscillator,
  pluckEnvelope,
  SAMPLE_RATE,
  samples,
  shape,
} from './dsp.ts';

const TAU = Math.PI * 2;

/** A pad note: three slightly detuned saws, low-passed and breathing, with a slow swell. */
export function padNote(
  note: number,
  seconds: number,
  random: () => number,
  cutoff = 1500,
): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(seconds));
  for (const cents of [-7, 0, 6]) {
    const saw = oscillator('saw', hz * 2 ** (cents / 1200), seconds, random());
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (saw[i] ?? 0) / 3;
  }
  const wobble = random() * TAU;
  filter(out, 'lowpass', (t) => cutoff * (1 + 0.18 * Math.sin(TAU * 0.23 * t + wobble)), 0.8);
  return shape(out, arEnvelope(seconds, Math.min(0.9, seconds / 3), Math.min(1.4, seconds / 2)));
}

/** An FM pluck, like a soft mallet on wood: the 2:1 modulator's brightness dies within 80 ms. */
export function pluck(note: number, velocity: number, decay = 0.24): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(decay * 5));
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const index = (1 + 2.6 * velocity) * Math.exp(-t / 0.09);
    out[i] = Math.sin(TAU * hz * t + index * Math.sin(TAU * 2 * hz * t));
  }
  return shape(out, pluckEnvelope(0.0025, decay));
}

/** A struck bell: an inharmonic 3.5:1 modulator rings over a long, quiet tail. */
export function bell(note: number, seconds = 2.8): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(seconds));
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const index = 2.4 * Math.exp(-t / 0.45);
    const body = Math.sin(TAU * hz * t + index * Math.sin(TAU * 3.5 * hz * t));
    const shimmer = 0.18 * Math.sin(TAU * 4.01 * hz * t) * Math.exp(-t / 0.3);
    out[i] = body + shimmer;
  }
  return shape(out, pluckEnvelope(0.004, seconds / 3.2));
}

/** A sub bass note: a sine with a touch of saturation for presence on small speakers. */
export function bassNote(note: number, seconds: number): Float32Array {
  const out = oscillator('sine', midiToHz(note), seconds);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(1.8 * (out[i] ?? 0)) / Math.tanh(1.8);
  return shape(out, arEnvelope(seconds, 0.008, 0.06));
}

/** A kick: a sine whose pitch falls from 150 to 52 Hz, tight, with a short felt click on top. */
export function kick(random: () => number): Float32Array {
  const body = oscillator('sine', (t) => 52 + 98 * Math.exp(-t / 0.03), 0.4);
  shape(body, (t) => Math.exp(-t / 0.115) * Math.min(1, t / 0.002));
  const click = filter(noise(0.012, random), 'bandpass', 3200, 0.9);
  shape(click, (t) => Math.exp(-t / 0.0025));
  for (let i = 0; i < click.length; i++) body[i] = (body[i] ?? 0) + 0.35 * (click[i] ?? 0);
  return body;
}

/** A hat: high-passed noise, closed or open. */
export function hat(random: () => number, open = false): Float32Array {
  const decay = open ? 0.12 : 0.03;
  const out = filter(noise(decay * 6, random), 'highpass', 7600, 0.8);
  return shape(out, pluckEnvelope(0.001, decay));
}

/** A clap: three quick band-passed bursts, then a short diffuse tail. */
export function clap(random: () => number): Float32Array {
  const out = filter(noise(0.4, random), 'bandpass', 1350, 0.75);
  return shape(out, (t) => {
    const bursts = [0, 0.011, 0.023].reduce(
      (sum, at) => sum + (t >= at ? Math.exp(-(t - at) / 0.0045) : 0),
      0,
    );
    return Math.min(1, bursts) + (t > 0.023 ? 0.55 * Math.exp(-(t - 0.023) / 0.09) : 0);
  });
}

/** A riser: noise through a band-pass sweeping up, swelling until it stops. */
export function riser(seconds: number, random: () => number): Float32Array {
  const out = filter(
    noise(seconds, random),
    'bandpass',
    (t) => 280 * (5600 / 280) ** ((t / seconds) ** 1.6),
    1.6,
  );
  return shape(out, (t) => (t / seconds) ** 2.2 * Math.min(1, (seconds - t) / 0.02));
}

/** An impact: a sub boom falling in pitch, and a burst of air that blooms into the reverb. */
export function impact(random: () => number, weight = 1): Float32Array {
  const boom = oscillator('sine', (t) => 34 + 40 * Math.exp(-t / 0.09), 2.2);
  shape(boom, (t) => Math.exp(-t / (0.55 * weight)) * Math.min(1, t / 0.004));
  const air = filter(noise(1.2, random), 'lowpass', 2400, 0.7);
  shape(air, (t) => 0.5 * Math.exp(-t / 0.18));
  for (let i = 0; i < air.length; i++) boom[i] = (boom[i] ?? 0) + (air[i] ?? 0);
  return boom;
}
