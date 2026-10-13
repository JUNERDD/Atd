/**
 * The release score's gestures between the instruments: the caret's blink pulse, the charge that
 * rises while a key is held, the swell that sucks into a drop, and the hit that lands it. Pitched
 * gestures take MIDI notes so they can sit in the score's key. Each returns a mono voice.
 */
import {
  filter,
  midiToHz,
  noise,
  oscillator,
  pulse,
  SAMPLE_RATE,
  samples,
  shape,
} from '../../../audio/dsp.ts';

/**
 * The caret's blink: a soft pitched blip with its octave, over a felt thump so it lands as a pulse
 * on the beat rather than a click.
 */
export function caretPulse(note: number): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(0.5));
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const tone = Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t);
    const thump = Math.sin(2 * Math.PI * (58 + 30 * Math.exp(-t / 0.02)) * t);
    out[i] = 0.6 * tone * Math.exp(-t / 0.11) + 0.4 * thump * Math.exp(-t / 0.07);
  }
  return shape(out, (t) => Math.min(1, t / 0.004));
}

/**
 * A hold charge: a pulse tone climbing from note `from` to `to` over `seconds`, its duty cycle
 * narrowing as it climbs, inside a band of noise that rises with it; it swells to the end and stops
 * dead, so whatever lands next lands on silence.
 */
export function charge(
  seconds: number,
  random: () => number,
  from: number,
  to: number,
): Float32Array {
  const pitch = (t: number) => midiToHz(from + (to - from) * (t / seconds) ** 1.4);
  const tone = pulse(pitch, (t) => 0.5 - 0.35 * (t / seconds), seconds);
  filter(tone, 'lowpass', (t) => 600 + 5200 * (t / seconds) ** 2, 1.4);
  const air = filter(noise(seconds, random), 'bandpass', (t) => 2 * pitch(t) + 800, 1.2);
  for (let i = 0; i < tone.length; i++) tone[i] = 0.6 * (tone[i] ?? 0) + 0.7 * (air[i] ?? 0);
  return shape(tone, (t) => (t / seconds) ** 2 * Math.min(1, (seconds - t) / 0.008));
}

/**
 * A swell into a drop: high-passed noise opening up as it grows, like a cymbal played backwards,
 * ending `gap` seconds before its full length so the drop lands after a breath.
 */
export function swell(seconds: number, random: () => number, gap = 0): Float32Array {
  const end = seconds - gap;
  const out = filter(
    noise(seconds, random),
    'highpass',
    (t) => 6000 - 4800 * Math.min(1, t / end),
    0.8,
  );
  filter(out, 'lowpass', (t) => 3000 + 13000 * Math.min(1, t / end), 0.7);
  return shape(out, (t) => (t >= end ? 0 : (t / end) ** 2.6 * Math.min(1, (end - t) / 0.006)));
}

/**
 * The hit: a sub boom falling from 90 to 31 Hz, a punch of saturated mid body, a bright crack and
 * a burst of air for the reverb. `weight` stretches the boom; it is the biggest sound in the score.
 */
export function hit(random: () => number, weight = 1): Float32Array {
  const seconds = 2.6;
  const out = oscillator('sine', (t) => 31 + 59 * Math.exp(-t / 0.07), seconds);
  shape(out, (t) => Math.exp(-t / (0.7 * weight)) * Math.min(1, t / 0.002));
  const punch = oscillator('sine', (t) => 120 + 140 * Math.exp(-t / 0.015), 0.3);
  const crack = filter(noise(0.25, random), 'bandpass', 2600, 0.6);
  const air = filter(noise(seconds, random), 'lowpass', 3200, 0.7);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const mid = Math.tanh(2.2 * (punch[i] ?? 0)) * Math.exp(-t / 0.05);
    const snap = (crack[i] ?? 0) * Math.exp(-t / 0.03);
    out[i] = (out[i] ?? 0) + 0.45 * mid + 0.7 * snap + 0.35 * (air[i] ?? 0) * Math.exp(-t / 0.4);
  }
  return out;
}
