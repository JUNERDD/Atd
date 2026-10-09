/**
 * A Freeverb-style plate: eight damped combs in parallel, then four allpasses in series, per
 * channel, the right channel's delays spread a little longer for width. It turns the dry send into
 * the room the soundtrack's pads, plucks and chimes ring in.
 */
import { SAMPLE_RATE, type Stereo } from './dsp.ts';

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;
const SCALE = SAMPLE_RATE / 44100;

class Comb {
  private readonly buffer: Float32Array;
  private index = 0;
  private store = 0;
  private readonly feedback: number;
  private readonly damp: number;

  constructor(length: number, feedback: number, damp: number) {
    this.buffer = new Float32Array(length);
    this.feedback = feedback;
    this.damp = damp;
  }

  process(input: number): number {
    const output = this.buffer[this.index] ?? 0;
    this.store = output * (1 - this.damp) + this.store * this.damp;
    this.buffer[this.index] = input + this.store * this.feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return output;
  }
}

class Allpass {
  private readonly buffer: Float32Array;
  private index = 0;

  constructor(length: number) {
    this.buffer = new Float32Array(length);
  }

  process(input: number): number {
    const buffered = this.buffer[this.index] ?? 0;
    this.buffer[this.index] = input + buffered * 0.5;
    this.index = (this.index + 1) % this.buffer.length;
    return buffered - input;
  }
}

function channel(input: Float32Array, spread: number, room: number, damp: number): Float32Array {
  const combs = COMBS.map((length) => new Comb(Math.round((length + spread) * SCALE), room, damp));
  const allpasses = ALLPASSES.map((length) => new Allpass(Math.round((length + spread) * SCALE)));
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const x = (input[i] ?? 0) * 0.015;
    let sum = 0;
    for (const comb of combs) sum += comb.process(x);
    for (const allpass of allpasses) sum = allpass.process(sum);
    out[i] = sum;
  }
  return out;
}

/** The wet signal of a send: `room` (0.7–0.98) sets the tail's length, `damp` its darkness. */
export function reverb(send: Stereo, room = 0.86, damp = 0.32): Stereo {
  const mono = new Float32Array(send.left.length);
  for (let i = 0; i < mono.length; i++) mono[i] = ((send.left[i] ?? 0) + (send.right[i] ?? 0)) / 2;
  return {
    left: channel(mono, 0, room, damp),
    right: channel(mono, SPREAD, room, damp),
  };
}
