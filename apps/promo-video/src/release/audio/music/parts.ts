/**
 * The release score's harmonic parts, following `FORM` and the chord plan: the pulse pad (into a
 * mono bed the score chorus-widens), the electric piano's comp, stabs and held chords, the plucked
 * strings' arpeggios and their statement of the hook, and the sub bass locked to the kick. Nothing
 * sounds across the breath before each of the film's two hits.
 */
import { addMono, addMoving, mixInto, SAMPLE_RATE, type Stereo } from '../../../audio/dsp.ts';
import type { MusicBuses } from '../../../audio/master.ts';
import { bars, BAR, STEP } from '../../timeline.ts';
import { electricPiano, pulsePad, stringPluck } from '../instruments/keys.ts';
import { subBass } from '../instruments/lead.ts';
import { PATTERNS, stepAt } from './drums.ts';
import { FORM } from './form.ts';
import { chordAt, HOOK, hookNotes, spans } from './harmony.ts';

/** The drop and the finale's hit, in seconds. */
export const HITS = [bars(2), bars(22)] as const;
/** The silence left before each hit. */
const BREATH = 0.15;

/** Shortens a note that would sound into the breath before a hit. */
export function clip(start: number, seconds: number): number {
  for (const hit of HITS) {
    if (start < hit) return Math.max(0.01, Math.min(seconds, hit - BREATH - start));
  }
  return seconds;
}

/**
 * Stops everything already on the buses for the breath before each hit: a 20 ms fade, then
 * silence until the hit. It catches what `clip` cannot, such as echo repeats and drum tails.
 */
export function breathe(buses: MusicBuses): void {
  for (const hit of HITS) {
    const from = Math.round((hit - BREATH) * SAMPLE_RATE);
    const to = Math.round(hit * SAMPLE_RATE);
    for (const bus of [buses.ducked, buses.dry, buses.send]) {
      for (const channel of [bus.left, bus.right]) {
        for (let i = from; i < to && i < channel.length; i++) {
          const gain = Math.max(0, 1 - (i - from) / (0.02 * SAMPLE_RATE));
          channel[i] = (channel[i] ?? 0) * gain;
        }
      }
    }
  }
}

function feelAt(seconds: number) {
  return FORM[Math.min(FORM.length - 1, Math.max(0, Math.floor(seconds / BAR + 1e-9)))];
}

/** The pad: each chord span voiced low, its cutoff following each bar's feel, into a mono bed. */
export function pad(bed: Float32Array, end: number, random: () => number): void {
  for (const span of spans(end)) {
    const level = FORM[span.bar]?.pad ?? 0;
    if (level === 0) continue;
    const seconds = clip(span.start, span.seconds + 0.5);
    const cutoff = (t: number) => {
      const at = span.start + t;
      const feel = feelAt(at);
      const [from, to] = feel?.padCutoff ?? [1000, 1000];
      return from + (to - from) * ((at % BAR) / BAR);
    };
    for (const note of span.chord.voicing.slice(0, 4)) {
      mixInto(bed, pulsePad(note, seconds, random, cutoff), span.start, level);
    }
  }
}

/** The electric piano's rhythms, as (step, length in steps, velocity). */
const COMP = [
  [0, 3, 0.62],
  [6, 2, 0.45],
  [10, 5, 0.52],
] as const;
const STABS = [
  [2, 1.2, 0.5],
  [6, 1.2, 0.42],
  [10, 1.2, 0.5],
  [14, 1.2, 0.42],
] as const;

/** One bar of electric piano, rolled a few milliseconds per note and drifting across the field. */
export function keys(buses: MusicBuses, bar: number): void {
  const feel = FORM[bar];
  if (!feel || feel.keys === 'none') return;
  const hits =
    feel.keys === 'held'
      ? spans(bars(25))
          .filter((span) => span.bar === bar)
          .map((span) => [(span.start - bars(bar)) / STEP, span.seconds / STEP, 0.42] as const)
      : feel.keys === 'comp'
        ? COMP
        : STABS;
  for (const [step, length, velocity] of hits) {
    const start = bars(bar) + step * STEP;
    const chord = chordAt(start + 1e-3);
    const seconds = clip(start, bar === 24 ? 5 : length * STEP);
    for (const [index, note] of chord.voicing.entries()) {
      const at = start + index * 0.006;
      const voice = electricPiano(note, velocity, seconds);
      const drift = (t: number) => 0.32 * Math.sin(2 * Math.PI * 0.45 * (at + t) + index);
      addMoving(buses.ducked, voice, at, feel.keysLevel, drift);
      addMoving(buses.send, voice, at, feel.keysLevel * 0.3, drift);
    }
  }
}

const EIGHTHS = [0, 2, 4, 3, 1, 3, 5, 2];
const SIXTEENTHS = [0, 2, 1, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 0, 1, 3];

/** One bar of plucked strings into their own bus (the score adds their echo). */
export function strings(bus: Stereo, bar: number, random: () => number): void {
  const feel = FORM[bar];
  if (!feel || feel.strings === 'none') return;
  const pluck = (note: number, at: number, velocity: number, ring: number, position: number) => {
    const seconds = clip(at, ring);
    const voice = stringPluck(note, velocity, random, {
      seconds,
      ring,
      brightness: 0.5 + 0.3 * velocity,
    });
    addMono(bus, voice, at, feel.stringsLevel, position);
  };
  if (feel.strings === 'hook') {
    if (FORM[bar - 1]?.strings === 'hook') return;
    for (const note of hookNotes(HOOK.statement, bars(bar), 1)) {
      pluck(note.note - 12, note.at, 0.85, Math.max(0.5, note.length + 0.4), 0);
    }
    return;
  }
  const pattern = feel.strings === 'eighths' ? EIGHTHS : SIXTEENTHS;
  const every = 16 / pattern.length;
  pattern.forEach((degree, i) => {
    const at = stepAt(bar, i * every);
    const arp = chordAt(at + 1e-3).arp;
    const note = arp[degree % arp.length] ?? 68;
    const velocity = i % 2 === 0 ? 0.8 : 0.55;
    pluck(note, at, velocity, every === 1 ? 0.5 : 1.1, i % 2 === 0 ? -0.35 : 0.35);
  });
}

/** One bar of sub bass: locked to the kick, on the offbeats of a four-on-the-floor, or held. */
export function bass(buses: MusicBuses, bar: number): void {
  const feel = FORM[bar];
  if (!feel || feel.bass === 'none') return;
  const place = (at: number, seconds: number, from?: number) => {
    const root = chordAt(at + 1e-3).root;
    const voice = subBass(root, clip(at, seconds), from ?? root);
    addMono(buses.ducked, voice, at, feel.bassLevel);
  };
  if (feel.bass === 'long') {
    for (const span of spans(bars(25)).filter((s) => s.bar === bar)) {
      place(span.start, span.seconds - 0.04);
    }
    return;
  }
  const kicks = PATTERNS[feel.groove].kick;
  const steps =
    feel.groove === 'four'
      ? [2, 6, 10, 14]
      : kicks.split('').flatMap((mark, i) => (mark === '.' ? [] : [i]));
  steps.forEach((step, index) => {
    const next = steps[index + 1] ?? 16;
    const at = stepAt(bar, step);
    const dive = HITS.some((hit) => Math.abs(hit - at) < 1e-6);
    const root = chordAt(at + 1e-3).root;
    place(at, (next - step) * STEP - 0.03, dive ? root + 12 : undefined);
  });
}
