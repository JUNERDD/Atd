/**
 * The release score's tonal voices, each rendering one note as a mono voice: an FM electric piano
 * (1:1 body with a 14:1 tine on the attack), a Karplus–Strong plucked string and a pulse-width pad.
 * None of them shares a recipe with the launch film's FM pluck, bell or saw pad. Levels are left to
 * the score.
 */
import {
  arEnvelope,
  filter,
  midiToHz,
  pulse,
  SAMPLE_RATE,
  samples,
  shape,
} from '../../../audio/dsp.ts';

const TAU = Math.PI * 2;

/**
 * An electric-piano note held for `seconds`, then released over a quarter second. The 1:1
 * modulator gives the warm bark that softens as the note sustains; harder `velocity` (0–1) barks
 * more and rings the tine brighter. Higher notes die sooner, as tines do.
 */
export function electricPiano(note: number, velocity: number, seconds: number): Float32Array {
  const hz = midiToHz(note);
  const release = 0.25;
  const out = new Float32Array(samples(seconds + release));
  const decay = 1.7 * 2 ** (-(note - 60) / 24);
  const bark = 0.35 + 1.5 * velocity;
  const tine = 0.18 + 0.3 * velocity;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const index = bark * Math.exp(-t / 0.5) + 0.12;
    const body = Math.sin(TAU * hz * t + index * Math.sin(TAU * hz * t));
    const ring = Math.sin(TAU * hz * t + 1.6 * Math.exp(-t / 0.018) * Math.sin(TAU * 14 * hz * t));
    out[i] = body + tine * ring * Math.exp(-t / 0.08);
  }
  return shape(out, (t) => {
    const attack = Math.min(1, t / 0.002);
    const sustain = 0.25 + 0.75 * Math.exp(-t / decay);
    const tail = t < seconds ? 1 : Math.max(0, 1 - (t - seconds) / release);
    return attack * sustain * tail;
  });
}

export interface StringOptions {
  /** How long the voice lasts in seconds; it is faded out over its last 50 ms. */
  seconds: number;
  /** Seconds for the string to fall 60 dB. */
  ring: number;
  /** 0–1: how bright the pluck's noise burst is, as a pick near the bridge or a soft finger. */
  brightness: number;
}

const STRING_DEFAULTS: StringOptions = { seconds: 1.4, ring: 1.6, brightness: 0.55 };

/**
 * A Karplus–Strong plucked string: a burst of filtered noise circulating through a delay line one
 * period long, an averaging filter darkening it each pass and a first-order allpass tuning the
 * fractional part of the period, so the pitch is exact at any note.
 */
export function stringPluck(
  note: number,
  velocity: number,
  random: () => number,
  options: Partial<StringOptions> = {},
): Float32Array {
  const { seconds, ring, brightness } = { ...STRING_DEFAULTS, ...options };
  const period = SAMPLE_RATE / midiToHz(note);
  const whole = Math.max(2, Math.floor(period - 0.5));
  const fraction = period - 0.5 - whole;
  const tuning = (1 - fraction) / (1 + fraction);
  const loss = 10 ** ((-3 * period) / SAMPLE_RATE / ring);
  const line = new Float32Array(whole);
  let smooth = 0;
  for (let i = 0; i < whole; i++) {
    smooth += (random() * 2 - 1 - smooth) * (0.15 + 0.85 * brightness);
    line[i] = smooth * velocity;
  }
  const mean = line.reduce((sum, x) => sum + x, 0) / whole;
  for (let i = 0; i < whole; i++) line[i] = (line[i] ?? 0) - mean;

  const out = new Float32Array(samples(seconds));
  let index = 0;
  let previous = 0;
  let allIn = 0;
  let allOut = 0;
  for (let i = 0; i < out.length; i++) {
    const current = line[index] ?? 0;
    const averaged = loss * 0.5 * (current + previous);
    previous = current;
    allOut = tuning * averaged + allIn - tuning * allOut;
    allIn = averaged;
    line[index] = allOut;
    out[i] = current;
    index = (index + 1) % whole;
  }
  filter(out, 'highpass', 70);
  return shape(out, (t) => Math.min(1, (seconds - t) / 0.05));
}

/**
 * A pad note from two pulse waves a few cents apart whose duty cycles drift slowly against each
 * other, low-passed (the cutoff may follow `cutoff(t)`) and swelling in. Chorused by the score, it
 * reads as a soft analog bed rather than the launch film's bright saw pad.
 */
export function pulsePad(
  note: number,
  seconds: number,
  random: () => number,
  cutoff: number | ((t: number) => number) = 1200,
): Float32Array {
  const hz = midiToHz(note);
  const out = new Float32Array(samples(seconds));
  for (const [index, cents] of [-6, 5].entries()) {
    const drift = random() * TAU;
    const voice = pulse(
      hz * 2 ** (cents / 1200),
      (t) => 0.36 + 0.12 * Math.sin(TAU * (0.21 + 0.07 * index) * t + drift),
      seconds,
      random(),
    );
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (voice[i] ?? 0) * 0.5;
  }
  filter(out, 'lowpass', cutoff, 0.7);
  return shape(out, arEnvelope(seconds, Math.min(0.7, seconds / 3), Math.min(1.2, seconds / 2)));
}
