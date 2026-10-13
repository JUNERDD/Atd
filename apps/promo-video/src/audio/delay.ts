/**
 * Time-based effects that the plate reverb cannot give: a feedback echo that can bounce between
 * the speakers, and a chorus that turns a mono voice into a slowly shifting stereo pair. Both are
 * offline and deterministic, and return only the wet signal so the caller sets the blend.
 */
import { Biquad, SAMPLE_RATE, type Stereo } from './dsp.ts';

export interface EchoOptions {
  /** Delay time in seconds; for a tempo-synced echo pass a note length (a dotted eighth, …). */
  time: number;
  /** How much of each repeat feeds the next, 0–0.9. */
  feedback: number;
  /** Low-pass cutoff inside the loop in Hz, so each repeat is darker than the last. */
  damp: number;
  /** High-pass cutoff inside the loop in Hz, so repeats never pile up in the low end. */
  thin: number;
  /** Repeats alternate left and right instead of sitting where the source is. */
  pingPong: boolean;
  /** Extra seconds rendered past the input for the repeats to die away. */
  tail: number;
}

const ECHO_DEFAULTS: EchoOptions = {
  time: 0.45,
  feedback: 0.42,
  damp: 3800,
  thin: 260,
  pingPong: true,
  tail: 0,
};

/**
 * The wet repeats of a stereo bus. In ping-pong mode the two channels' sum enters the left line,
 * and each line feeds the other, so repeats walk left, right, left as they fade.
 */
export function echo(input: Stereo, options: Partial<EchoOptions> = {}): Stereo {
  const { time, feedback, damp, thin, pingPong, tail } = { ...ECHO_DEFAULTS, ...options };
  const delay = Math.max(1, Math.round(time * SAMPLE_RATE));
  const length = input.left.length + Math.round(tail * SAMPLE_RATE);
  const out: Stereo = { left: new Float32Array(length), right: new Float32Array(length) };
  const lineL = new Float32Array(delay);
  const lineR = new Float32Array(delay);
  const darkL = new Biquad('lowpass', damp);
  const darkR = new Biquad('lowpass', damp);
  const lightL = new Biquad('highpass', thin);
  const lightR = new Biquad('highpass', thin);
  for (let i = 0; i < length; i++) {
    const index = i % delay;
    const inL = input.left[i] ?? 0;
    const inR = input.right[i] ?? 0;
    const tapL = lineL[index] ?? 0;
    const tapR = lineR[index] ?? 0;
    out.left[i] = tapL;
    out.right[i] = tapR;
    const backL = lightL.process(darkL.process(tapL)) * feedback;
    const backR = lightR.process(darkR.process(tapR)) * feedback;
    if (pingPong) {
      lineL[index] = (inL + inR) * 0.5 + backR;
      lineR[index] = backL;
    } else {
      lineL[index] = inL + backL;
      lineR[index] = inR + backR;
    }
  }
  return out;
}

export interface ChorusOptions {
  /** Centre delay in seconds. */
  delay: number;
  /** How far the delay swings either way, in seconds. */
  depth: number;
  /** The two sides' modulation rates in Hz, slightly apart so the image keeps moving. */
  rates: [number, number];
}

const CHORUS_DEFAULTS: ChorusOptions = { delay: 0.014, depth: 0.004, rates: [0.37, 0.53] };

/** Reads a buffer at a fractional position, linearly interpolated. */
function tap(buffer: Float32Array, position: number): number {
  const whole = Math.floor(position);
  const frac = position - whole;
  return (buffer[whole] ?? 0) * (1 - frac) + (buffer[whole + 1] ?? 0) * frac;
}

/**
 * A two-voice chorus: the mono voice read through two delay lines whose lengths swing in opposite
 * phase, one per side. Mixed with the dry voice centred, it widens and thickens without detuning
 * the attack.
 */
export function chorus(voice: Float32Array, options: Partial<ChorusOptions> = {}): Stereo {
  const { delay, depth, rates } = { ...CHORUS_DEFAULTS, ...options };
  const out: Stereo = {
    left: new Float32Array(voice.length),
    right: new Float32Array(voice.length),
  };
  const sides = [out.left, out.right] as const;
  for (const [side, channel] of sides.entries()) {
    const rate = rates[side] ?? rates[0];
    const offset = side * Math.PI;
    for (let i = 0; i < voice.length; i++) {
      const t = i / SAMPLE_RATE;
      const lag = (delay + depth * Math.sin(2 * Math.PI * rate * t + offset)) * SAMPLE_RATE;
      channel[i] = i - lag < 0 ? 0 : tap(voice, i - lag);
    }
  }
  return out;
}
