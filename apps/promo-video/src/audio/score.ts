/**
 * The music, in D major at the film's 120 BPM, a chord to a bar: Dmaj9, Bm9, Gmaj9, A6/9. Its
 * sections follow the picture: an airy intro under the display, a bouncing groove (four-on-the-floor
 * kick, off-beat bass, rolling plucks) from the beat drop that opens the tour, a breakdown under the
 * features and privacy, then the groove again with a bell melody for the call to action.
 */
import { BAR, BEAT, CASES_START, DURATION, FEATURES, OUTRO } from '../timeline.ts';
import { addMono, prng, SAMPLE_RATE, stereo, type Stereo } from './dsp.ts';
import { bassNote, bell, clap, hat, kick, padNote, pluck } from './instruments.ts';

interface Chord {
  root: number;
  pad: number[];
  arp: number[];
  /** The ninth, rung by the bells on downbeats. */
  ninth: number;
}

const CHORDS: Chord[] = [
  { root: 38, pad: [50, 57, 61, 64, 66], arp: [62, 66, 69, 73, 76], ninth: 76 },
  { root: 35, pad: [47, 54, 57, 61, 62], arp: [59, 62, 66, 69, 73], ninth: 73 },
  { root: 31, pad: [43, 50, 54, 57, 61], arp: [55, 62, 66, 69, 74], ninth: 81 },
  { root: 33, pad: [45, 52, 54, 59, 61], arp: [57, 61, 64, 66, 71], ninth: 71 },
];

const SIXTEENTHS = [0, 1, 2, 4, 3, 2, 1, 2, 0, 2, 3, 4, 3, 1, 2, 3];
const EIGHTHS = [0, 2, 4, 3, 1, 3, 4, 2];

/** The finale's bell line: [bar from the outro's start, beat, note, beats held]. */
const MELODY: [number, number, number, number][] = [
  [0, 0, 78, 1],
  [0, 1, 81, 1],
  [0, 2, 76, 2],
  [1, 0, 74, 1],
  [1, 1, 78, 1],
  [1, 2, 73, 2],
  [2, 0, 71, 1],
  [2, 1, 74, 1],
  [2, 2, 81, 1],
  [2, 3, 78, 1],
  [3, 0, 76, 1.5],
  [3, 1.5, 73, 0.5],
  [3, 2, 76, 1],
  [3, 3, 81, 1],
];

type Section = 'intro' | 'groove' | 'lift' | 'breakdown' | 'finale' | 'ending';

const GROOVE_BAR = CASES_START / BAR;
const LIFT_BAR = GROOVE_BAR + 8;
const BREAK_BAR = FEATURES.start / BAR;
const FINALE_BAR = OUTRO.start / BAR;
const ENDING_BAR = FINALE_BAR + 4;

const SECTIONS: [Section, number][] = [
  ['ending', ENDING_BAR],
  ['finale', FINALE_BAR],
  ['breakdown', BREAK_BAR],
  ['lift', LIFT_BAR],
  ['groove', GROOVE_BAR],
  ['intro', 0],
];

function sectionOf(bar: number): [Section, number] {
  return SECTIONS.find(([, start]) => bar >= start) ?? ['intro', 0];
}

/**
 * Every section starts on Dmaj9 and walks the progression from there; the intro's last bar holds
 * the A so the beat drop resolves home.
 */
function chordOf(bar: number): Chord {
  const [section, start] = sectionOf(bar);
  const index = section === 'intro' && bar === GROOVE_BAR - 1 ? 3 : (bar - start) % CHORDS.length;
  return CHORDS[index] ?? CHORDS[0] ?? { root: 38, pad: [], arp: [], ninth: 76 };
}

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

export function renderScore(): MusicBuses {
  const random = prng(7);
  const buses: MusicBuses = {
    ducked: stereo(DURATION),
    dry: stereo(DURATION),
    send: stereo(DURATION),
    kicks: [],
  };
  const bars = Math.round(DURATION / BAR);

  for (let bar = 0; bar < bars; bar++) {
    const at = bar * BAR;
    const [section] = sectionOf(bar);
    const chord = chordOf(bar);
    const ending = section === 'ending';
    const busy = section === 'groove' || section === 'lift' || section === 'finale';

    // Pad: swells in under the intro, opens up for the groove, rings out at the end.
    const fadeIn = Math.min(1, (bar + 0.5) / 2);
    const padGain = (section === 'breakdown' ? 0.12 : busy ? 0.095 : 0.1) * fadeIn;
    const cutoff = {
      intro: 950 + bar * 160,
      groove: 1700,
      lift: 2100,
      breakdown: 1450,
      finale: 2300,
      ending: 1900,
    }[section];
    for (const [index, note] of chord.pad.entries()) {
      const length = ending ? DURATION - at + 1 : BAR + 0.7;
      const voice = padNote(note, length, random, cutoff);
      const position = (index / (chord.pad.length - 1)) * 1.2 - 0.6;
      addMono(buses.ducked, voice, Math.max(0, at - 0.12), padGain, position);
      addMono(buses.send, voice, Math.max(0, at - 0.12), padGain * 0.55, position);
    }

    // Plucks: eighths over the intro and breakdown, rolling sixteenths in the grooves.
    if (!ending && bar >= 1) {
      const pattern = busy ? SIXTEENTHS : EIGHTHS;
      const step = BAR / pattern.length;
      pattern.forEach((degree, i) => {
        const note = chord.arp[degree] ?? chord.arp[0] ?? 62;
        const accent = i % 4 === 0 ? 1 : 0.55 + 0.3 * random();
        const gain = (busy ? 0.125 : 0.09) * accent;
        const start = at + i * step;
        const voice = pluck(note, accent, busy ? 0.2 : 0.3);
        const position = i % 2 === 0 ? -0.3 : 0.3;
        addMono(buses.ducked, voice, start, gain, position);
        // A ping-pong echo a dotted eighth later, softer, on the other side.
        addMono(buses.ducked, voice, start + 0.75 * BEAT, gain * 0.32, -position * 2);
        addMono(buses.send, voice, start, gain * 0.5, position);
      });
    }

    // Drums and bass in the grooves.
    if (busy) {
      for (let beat = 0; beat < 4; beat++) {
        const beatAt = at + beat * BEAT;
        const lastBeforeBreak = bar === BREAK_BAR - 1 && beat === 3;
        if (!lastBeforeBreak) {
          addMono(buses.dry, kick(random), beatAt, 0.44);
          buses.kicks.push(beatAt);
        }
        const offbeat = beatAt + BEAT / 2;
        addMono(buses.ducked, bassNote(chord.root, BEAT * 0.42), offbeat, 0.22);
        addMono(buses.dry, hat(random, beat === 3 && bar % 2 === 1), offbeat, 0.065, 0.25);
        if (section !== 'groove') {
          addMono(buses.dry, hat(random), beatAt + BEAT / 4, 0.018, -0.3);
          addMono(buses.dry, hat(random), beatAt + (3 * BEAT) / 4, 0.016, 0.35);
          if (beat === 1 || beat === 3) {
            const hand = clap(random);
            addMono(buses.dry, hand, beatAt, 0.11, -0.1);
            addMono(buses.send, hand, beatAt, 0.1);
          }
        }
      }
    }

    // Bells: a ninth on each downbeat of the lift, two notes a bar in the breakdown.
    const ring = (note: number, start: number, gain: number, seconds = 2.8) => {
      const voice = bell(note, seconds);
      addMono(buses.dry, voice, start, gain, 0.15);
      addMono(buses.send, voice, start, gain * 1.1, 0.15);
    };
    if (section === 'lift') ring(chord.ninth, at, 0.05);
    if (section === 'breakdown') {
      ring(chord.arp[3] ?? 73, at, 0.055);
      ring(chord.arp[4] ?? 76, at + 2 * BEAT, 0.045);
    }
  }

  // The finale's melody, then the last chord rung on the bells as the picture fades.
  for (const [bar, beat, note, held] of MELODY) {
    const start = OUTRO.start + bar * BAR + beat * BEAT;
    const voice = bell(note, Math.max(1.6, held * BEAT * 3));
    addMono(buses.dry, voice, start, 0.07, 0.1);
    addMono(buses.send, voice, start, 0.08, 0.1);
  }
  for (const [index, note] of [74, 78, 81, 86].entries()) {
    const voice = bell(note, DURATION - ENDING_BAR * BAR + 0.5);
    addMono(buses.dry, voice, ENDING_BAR * BAR + index * 0.045, 0.05, index % 2 ? 0.3 : -0.3);
    addMono(buses.send, voice, ENDING_BAR * BAR + index * 0.045, 0.07);
  }
  return buses;
}

/** The sidechain: a quick dip at each kick that recovers within a beat. */
export function duck(buses: MusicBuses, depth = 0.55): void {
  const kicks = buses.kicks.map((at) => Math.round(at * SAMPLE_RATE));
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
