/**
 * The music, in D major at the film's 120 BPM, a chord to a bar (Dmaj9, Bm9, Gmaj9, A6/9). It
 * follows the picture: an airy intro whose pad enters with the keycaps and opens as the mark forms,
 * rising into a beat drop on "Anywhere"; a lift with more drive on "Anything"; a filtered, half-time
 * night on "Anytime" with bells rippling as the clock races, brightening at dawn and finding its
 * beat again for memory; a build under the models; and the full groove with a bell melody for the
 * finale, ending on a ringing chord as the picture fades. `arrangement.ts` places every part.
 */
import { at, BAR, BEAT, CHOREO, DURATION, SECTIONS } from '../timeline.ts';
import {
  type BarPlan,
  breathes,
  FEEL,
  LAST_CHORD,
  MELODY,
  plan,
  RING_START,
} from './arrangement.ts';
import { addMono, filter, prng, SAMPLE_RATE, stereo, type Stereo } from './dsp.ts';
import { bell, padNote, pluck, riser } from './instruments.ts';
import { rhythm } from './rhythm.ts';

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

/** Arpeggio degrees: rolling sixteenths for the grooves, slower eighths for the quiet parts. */
const SIXTEENTHS = [0, 1, 2, 4, 3, 2, 1, 2, 0, 2, 3, 4, 3, 1, 2, 3];
const EIGHTHS = [0, 2, 4, 3, 1, 3, 4, 2];

const OPEN_KEYS = CHOREO.open.keys.map((key) => at('open', key));
const BLOOM = at('open', CHOREO.open.bloom);
const [CLOCK_FROM, CLOCK_TO] = CHOREO.anytime.timelapse.clock.map((s) => at('anytime', s));

function lerp([from, to]: [number, number], progress: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, progress));
}

/** How far through its part a moment is, from 0 to 1. */
function through(bar: BarPlan, seconds: number): number {
  const partStart = bar.start - bar.nth * BAR;
  return (seconds - partStart) / (bar.count * BAR);
}

/**
 * The pad holds each bar's chord. In the film's first bar its notes enter with the keycaps, two
 * at a time, so the chord breathes in with each press; the cutoff opens across every part.
 */
function pads(buses: MusicBuses, bar: BarPlan, random: () => number): void {
  const feel = FEEL[bar.part];
  const notes = bar.chord.pad;
  const until = bar.part === 'ring' ? DURATION + 1 : bar.start + BAR + 0.7;
  for (const [index, note] of notes.entries()) {
    const entry =
      bar.part === 'intro' && bar.nth === 0
        ? (OPEN_KEYS[Math.min(OPEN_KEYS.length - 1, Math.floor(index / 2))] ?? bar.start)
        : bar.start - 0.12;
    if (entry >= bar.start + BAR) continue;
    const start = Math.max(0, entry);
    const voice = padNote(note, until - start, random, (t) =>
      lerp(feel.padCutoff, through(bar, start + t)),
    );
    const position = (index / (notes.length - 1)) * 1.2 - 0.6;
    addMono(buses.ducked, voice, start, feel.pad, position);
    addMono(buses.send, voice, start, feel.pad * 0.55, position);
  }
}

/**
 * Plucked arpeggios with a ping-pong echo. The intro's start with the light's bloom and roll into
 * sixteenths in its last bar; the night's are low-passed and long; the build's open up and swell.
 */
function plucks(buses: MusicBuses, bar: BarPlan, random: () => number): void {
  const feel = FEEL[bar.part];
  if (feel.pluck === 'none') return;
  const rolling =
    feel.pluck === 'sixteenths' || (bar.part === 'intro' && bar.nth === bar.count - 1);
  const pattern = rolling ? SIXTEENTHS : EIGHTHS;
  const step = BAR / pattern.length;
  const dreamy = bar.part === 'night' || bar.part === 'dawn';
  pattern.forEach((degree, i) => {
    const start = bar.start + i * step;
    if (bar.part === 'intro' && start < BLOOM - 1e-6) return;
    if (breathes(bar) && start >= bar.start + 3 * BEAT - 1e-6) return;
    const progress = through(bar, start);
    const note = bar.chord.arp[degree] ?? bar.chord.arp[0] ?? 62;
    const accent = i % 4 === 0 ? 1 : 0.55 + 0.3 * random();
    const swell =
      bar.part === 'intro'
        ? 0.6 + 0.5 * progress
        : bar.part === 'build'
          ? 0.45 + 0.8 * progress
          : 1;
    const gain = feel.pluckGain * accent * swell;
    const voice = pluck(note, accent, dreamy ? 0.38 : rolling ? 0.2 : 0.3);
    const tone = lerp(feel.pluckTone, progress);
    if (tone < 8000) filter(voice, 'lowpass', tone);
    const position = i % 2 === 0 ? -0.3 : 0.3;
    addMono(buses.ducked, voice, start, gain, position);
    addMono(buses.ducked, voice, start + 0.75 * BEAT, gain * (dreamy ? 0.45 : 0.32), -position * 2);
    addMono(buses.send, voice, start, gain * (dreamy ? 0.9 : 0.5), position);
  });
}

function ring(buses: MusicBuses, note: number, start: number, gain: number, seconds = 2.8) {
  const voice = bell(note, seconds);
  addMono(buses.dry, voice, start, gain, 0.15);
  addMono(buses.send, voice, start, gain * 1.1, 0.15);
}

/** Bells: the ninth on each downbeat of the lift, two notes a bar while memory finds its beat. */
function bells(buses: MusicBuses, bar: BarPlan): void {
  if (bar.part === 'lift' && bar.start < at('anything', CHOREO.anything.tools.pullOut)) {
    ring(buses, bar.chord.ninth, bar.start, 0.05);
  }
  if (bar.part === 'memory') {
    ring(buses, bar.chord.arp[3] ?? 73, bar.start, 0.05);
    ring(buses, bar.chord.arp[4] ?? 76, bar.start + 2 * BEAT, 0.04);
  }
}

/**
 * As the night's clock races, the bells ripple up the chord an octave above the plucks: eighths,
 * then sixteenths for the second half of the time-lapse.
 */
function clockRipple(buses: MusicBuses, bars: BarPlan[]): void {
  const from = CLOCK_FROM ?? 0;
  const to = CLOCK_TO ?? from;
  let t = Math.ceil(from / (BEAT / 2) - 1e-6) * (BEAT / 2);
  for (let k = 0; t < to; k++) {
    const progress = (t - from) / (to - from);
    const chord = bars.find(({ start }) => t >= start && t < start + BAR)?.chord;
    const note = (chord?.arp[k % 5] ?? 74) + 12;
    ring(buses, note, t, 0.016 + 0.01 * progress, 1.6);
    t += progress < 0.5 ? BEAT / 2 : BEAT / 4;
  }
}

export function renderScore(): MusicBuses {
  const random = prng(7);
  const buses: MusicBuses = {
    ducked: stereo(DURATION),
    dry: stereo(DURATION),
    send: stereo(DURATION),
    kicks: [],
  };
  const bars = plan();
  for (const bar of bars) {
    pads(buses, bar, random);
    plucks(buses, bar, random);
    rhythm(buses, bar, random);
    bells(buses, bar);
  }
  clockRipple(buses, bars);

  // Tension: a riser from the tagline into the drop, and another across the models into the finale.
  for (const [from, to, gain] of [
    [at('open', CHOREO.open.tagline), SECTIONS.anywhere.start, 0.24],
    [SECTIONS.yours.start, SECTIONS.finale.start, 0.2],
  ] as const) {
    const voice = riser(to - from, random);
    addMono(buses.dry, voice, from, gain);
    addMono(buses.send, voice, from, gain * 0.7);
  }

  // The finale's melody, then the last chord rung on the bells as the picture fades.
  for (const [bar, beat, note, held] of MELODY) {
    const start = SECTIONS.finale.start + bar * BAR + beat * BEAT;
    const voice = bell(note, Math.max(1.6, held * BEAT * 3));
    addMono(buses.dry, voice, start, 0.07, 0.1);
    addMono(buses.send, voice, start, 0.08, 0.1);
  }
  for (const [index, note] of LAST_CHORD.entries()) {
    const start = RING_START + index * 0.045;
    const voice = bell(note, DURATION - RING_START + 0.5);
    addMono(buses.dry, voice, start, 0.05, index % 2 ? 0.3 : -0.3);
    addMono(buses.send, voice, start, 0.07);
  }
  return buses;
}

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
