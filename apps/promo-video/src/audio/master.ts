/**
 * Mastering: the buses meet in one mix with a shared reverb, the ends are faded, the whole is set
 * to a streaming loudness measured the ITU-R BS.1770 way, and a soft limiter keeps peaks under the
 * ceiling. Every film's soundtrack goes through `mixdown`. Also writes 16-bit PCM WAV files.
 */
import type { EffectBuses } from './cue-bus.ts';
import { addStereo, Biquad, dbToGain, prng, SAMPLE_RATE, stereo, type Stereo } from './dsp.ts';
import { reverb } from './reverb.ts';

/** What a score renders, for the mix to sidechain and reverberate. */
export interface MusicBuses {
  /** Pad, bass and plucks: ducked under the kick. */
  ducked: Stereo;
  /** Drums and bells, never ducked. */
  dry: Stereo;
  /** What feeds the reverb. */
  send: Stereo;
  /** Every kick, in seconds, for the sidechain. */
  kicks: number[];
}

/** Integrated loudness for web and social video; the platforms normalize near -14 LUFS. */
const TARGET_LUFS = -15;
const WET = 1.1;

/** The sidechain: a quick dip at each kick that recovers within a beat. */
export function duck(buses: MusicBuses, depth = 0.55): void {
  const kicks = [...buses.kicks].sort((a, b) => a - b).map((at) => Math.round(at * SAMPLE_RATE));
  let next = 0;
  let last = -Infinity;
  const { left, right } = buses.ducked;
  for (let i = 0; i < left.length; i++) {
    while (next < kicks.length && (kicks[next] ?? Infinity) <= i) last = kicks[next++] ?? last;
    const since = (i - last) / SAMPLE_RATE;
    const gain =
      since < 0 ? 1 : 1 - depth * Math.exp(-since / 0.09) * Math.min(1, since / 0.004 + 0.4);
    left[i] = (left[i] ?? 0) * gain;
    right[i] = (right[i] ?? 0) * gain;
  }
}

export interface Mixdown {
  /** The mastered soundtrack. */
  mix: Stereo;
  /** The music and the effects before the fades and the limiter, at the mix's makeup gain. */
  music: Stereo;
  effects: Stereo;
  /** The mix's loudness before its makeup gain, in LUFS. */
  measured: number;
}

/**
 * Mixes a film's `seconds` of score and cues: the score ducks under its kicks, music and effects
 * each get their share of the plate, the ends fade, and the mix is brought to the target loudness
 * under a -1 dBFS ceiling.
 */
export function mixdown(seconds: number, score: MusicBuses, cues: EffectBuses): Mixdown {
  const sum = (...buses: [Stereo, number][]): Stereo => {
    const out = stereo(seconds);
    for (const [bus, level] of buses) addStereo(out, bus, level);
    return out;
  };
  duck(score);
  const music = sum([score.ducked, 1], [score.dry, 1], [reverb(score.send), WET]);
  const effects = sum([cues.dry, 1], [reverb(cues.send, 0.8, 0.4), WET]);
  const mix = sum([music, 1], [effects, 1]);

  fadeEnds(mix, 0.01, 1.6);
  const measured = loudness(mix);
  const makeup = 10 ** ((TARGET_LUFS - measured) / 20);
  gain(mix, makeup);
  limit(mix, -1);
  gain(music, makeup);
  gain(effects, makeup);
  return { mix, music, effects, measured };
}

/** Integrated loudness in LUFS: K-weighting, 400 ms blocks every 100 ms, absolute and relative gates. */
export function loudness(mix: Stereo): number {
  const weighted = [mix.left, mix.right].map((channel) => {
    const shelf = new Biquad('highshelf', 1681.97, 0.7072, 4);
    const highpass = new Biquad('highpass', 38.13, 0.5003);
    return channel.map((x) => highpass.process(shelf.process(x)));
  });
  const block = Math.round(0.4 * SAMPLE_RATE);
  const hop = Math.round(0.1 * SAMPLE_RATE);
  const powers: number[] = [];
  for (let start = 0; start + block <= mix.left.length; start += hop) {
    let sum = 0;
    for (const channel of weighted) {
      for (let i = start; i < start + block; i++) sum += (channel[i] ?? 0) ** 2;
    }
    powers.push(sum / block);
  }
  const lufs = (power: number) => -0.691 + 10 * Math.log10(power);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const audible = powers.filter((power) => lufs(power) > -70);
  const relative = lufs(mean(audible)) - 10;
  return lufs(mean(audible.filter((power) => lufs(power) > relative)));
}

/** Scales a mix in place. */
export function gain(mix: Stereo, factor: number): void {
  for (const channel of [mix.left, mix.right]) {
    for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * factor;
  }
}

/** Fades the first `fadeIn` and the last `fadeOut` seconds. */
export function fadeEnds(mix: Stereo, fadeIn: number, fadeOut: number): void {
  const length = mix.left.length;
  const inSamples = fadeIn * SAMPLE_RATE;
  const outSamples = fadeOut * SAMPLE_RATE;
  for (const channel of [mix.left, mix.right]) {
    for (let i = 0; i < length; i++) {
      const head = Math.min(1, i / inSamples);
      const tail = Math.min(1, (length - 1 - i) / outSamples);
      channel[i] = (channel[i] ?? 0) * head * Math.sin((Math.PI / 2) * tail);
    }
  }
}

/** A soft-knee limiter: transparent below the knee, a tanh curve above it, never past `ceiling` dBFS. */
export function limit(mix: Stereo, ceiling = -1, knee = -6): void {
  const top = dbToGain(ceiling);
  const start = dbToGain(knee);
  for (const channel of [mix.left, mix.right]) {
    for (let i = 0; i < channel.length; i++) {
      const x = channel[i] ?? 0;
      const level = Math.abs(x);
      if (level <= start) continue;
      const over = (level - start) / (top - start);
      channel[i] = Math.sign(x) * (start + (top - start) * Math.tanh(over));
    }
  }
}

export function peakDb(mix: Stereo): number {
  let peak = 0;
  for (const channel of [mix.left, mix.right]) {
    for (const x of channel) peak = Math.max(peak, Math.abs(x));
  }
  return 20 * Math.log10(peak || 1e-9);
}

/** A 16-bit stereo PCM WAV, with triangular dither. */
export function wav(mix: Stereo): Uint8Array {
  const frames = mix.left.length;
  const bytes = new Uint8Array(44 + frames * 4);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 4, true);
  const random = prng(3);
  for (let i = 0; i < frames; i++) {
    for (const [index, channel] of [mix.left, mix.right].entries()) {
      const dither = (random() - random()) / 32768;
      const value = Math.max(-1, Math.min(1, (channel[i] ?? 0) + dither));
      view.setInt16(44 + i * 4 + index * 2, Math.round(value * 32767), true);
    }
  }
  return bytes;
}
