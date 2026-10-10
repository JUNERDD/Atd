/**
 * Where the effects are mixed: one bus pair (dry and reverb send) and the placement helpers every
 * chapter's cues share, so each cue sits at a level that reads through the music under it.
 */
import { DURATION, SECTIONS, type SectionId } from '../timeline.ts';
import { addMono, addMoving, prng, stereo, type Stereo } from './dsp.ts';

export interface EffectBuses {
  dry: Stereo;
  send: Stereo;
}

/**
 * How much more level a cue needs to read through each section's music: the grooves want about
 * +6 dB over the quiet open, the filtered night and the build a little less.
 */
const UNDER_THE_MUSIC: [SectionId, number][] = [
  ['open', 1],
  ['anywhere', 2],
  ['anything', 2],
  ['anytime', 1.5],
  ['yours', 1.6],
  ['finale', 2],
];

/** A cue that leads into a cut by less than this belongs to the section it leads into. */
const LEAD_IN = 0.25;

function musicAt(seconds: number): number {
  const time = Math.min(DURATION - 1e-6, seconds + LEAD_IN);
  const found = UNDER_THE_MUSIC.find(
    ([id]) => time >= SECTIONS[id].start && time < SECTIONS[id].end,
  );
  return found?.[1] ?? 1;
}

export interface Cues {
  buses: EffectBuses;
  random: () => number;
  /** Places a voice at `at` seconds, panned at `position`, with `wet` of it sent to the reverb. */
  place(voice: Float32Array, at: number, gain: number, position?: number, wet?: number): void;
  /** Places a voice that travels across the stereo field, its pan following `position(t)`. */
  travel(
    voice: Float32Array,
    at: number,
    gain: number,
    position: (t: number) => number,
    wet?: number,
  ): void;
  /**
   * Fills a span with small sounds at a typing or streaming pace: `spacing` seconds apart on
   * average, each a little early or late, with `voice(i)` making the i-th.
   */
  patter(
    span: readonly [number, number],
    spacing: number,
    voice: (i: number) => Float32Array,
    gain: number,
    position?: number,
  ): void;
}

export function createCues(seed: number): Cues {
  const random = prng(seed);
  const buses: EffectBuses = { dry: stereo(DURATION), send: stereo(DURATION) };
  const level = (at: number, gain: number) => gain * musicAt(at);
  const place: Cues['place'] = (voice, at, gain, position = 0, wet = 0.25) => {
    addMono(buses.dry, voice, at, level(at, gain), position);
    if (wet > 0) addMono(buses.send, voice, at, level(at, gain) * wet, position);
  };
  const travel: Cues['travel'] = (voice, at, gain, position, wet = 0.3) => {
    addMoving(buses.dry, voice, at, level(at, gain), position);
    if (wet > 0) addMoving(buses.send, voice, at, level(at, gain) * wet, position);
  };
  const patter: Cues['patter'] = ([from, to], spacing, voice, gain, position = 0) => {
    let at = from;
    for (let i = 0; at < to; i++) {
      const accent = 0.75 + 0.25 * random();
      place(voice(i), at, gain * accent, position + 0.08 * (random() - 0.5), 0.08);
      at += spacing * (0.7 + 0.6 * random());
    }
  };
  return { buses, random, place, travel, patter };
}
