/**
 * The release score's line voices: a monophonic pulse lead that glides between tied notes and
 * leans into a delayed vibrato, and a warm sub bass. Each renders a mono voice; levels and
 * placement are left to the score.
 */
import {
  arEnvelope,
  Biquad,
  filter,
  midiToHz,
  oscillator,
  pulse,
  SAMPLE_RATE,
  samples,
} from '../../../audio/dsp.ts';

const TAU = Math.PI * 2;

/** One note of a line, in seconds from the line's start. */
export interface LineNote {
  at: number;
  length: number;
  note: number;
  /** 0–1, how hard the filter opens on this note; defaults to 0.7. */
  velocity?: number;
}

export interface LeadOptions {
  /** Time constant of the glide between tied notes, in seconds. */
  glide: number;
  /** Vibrato depth in semitones, reached 0.5 s into a held note. */
  vibrato: number;
  /** The filter's resting cutoff in Hz; each note's attack opens it above this. */
  cutoff: number;
}

const LEAD_DEFAULTS: LeadOptions = { glide: 0.03, vibrato: 0.16, cutoff: 1500 };
/** Notes closer than this are tied: the pitch glides and the amplitude does not restart. */
const TIE = 0.02;

/** The note sounding at sample `i`, or the last one that started. */
function current(notes: readonly LineNote[], t: number, from: number): number {
  let index = from;
  while (index + 1 < notes.length && (notes[index + 1]?.at ?? Infinity) <= t) index++;
  return index;
}

/**
 * A pulse lead playing `notes` (sorted by start) as one voice: a narrow pulse with a square a
 * fifth of the level an octave down for body, its pitch gliding when notes are tied, a vibrato
 * that grows on long notes, and a resonant low-pass that opens on every attack.
 */
export function leadLine(
  notes: readonly LineNote[],
  options: Partial<LeadOptions> = {},
): Float32Array {
  const { glide, vibrato, cutoff } = { ...LEAD_DEFAULTS, ...options };
  const last = notes.at(-1);
  if (!last) return new Float32Array(1);
  const length = samples(last.at + last.length + 0.4);
  const hz = new Float32Array(length);
  const gate = new Float32Array(length);
  const bright = new Float32Array(length);
  const follow = 1 - Math.exp(-1 / (glide * SAMPLE_RATE));
  let pitch = notes[0]?.note ?? 60;
  let index = 0;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const before = index;
    index = current(notes, t, index);
    const note = notes[index] ?? last;
    const previous = notes[index - 1];
    const tied = previous !== undefined && note.at - (previous.at + previous.length) < TIE;
    if (index !== before && !tied) pitch = note.note;
    pitch += (note.note - pitch) * follow;
    const into = t - note.at;
    const wobble = vibrato * Math.min(1, Math.max(0, (into - 0.2) / 0.3)) * Math.sin(TAU * 5.3 * t);
    hz[i] = midiToHz(pitch + wobble);
    gate[i] = into >= 0 && into < note.length ? 1 : 0;
    bright[i] = (note.velocity ?? 0.7) * Math.exp(-Math.max(0, into) / 0.13);
  }
  const at = (t: number) => Math.min(length - 1, Math.round(t * SAMPLE_RATE));
  const narrow = pulse(
    (t) => hz[at(t)] ?? 440,
    (t) => 0.3 + 0.06 * Math.sin(TAU * 0.6 * t),
    length / SAMPLE_RATE,
  );
  const body = pulse((t) => (hz[at(t)] ?? 440) / 2, 0.5, length / SAMPLE_RATE);
  const out = new Float32Array(length);
  const lowpass = new Biquad('lowpass', cutoff, 1.2);
  let level = 0;
  for (let i = 0; i < length; i++) {
    if (i % 32 === 0) lowpass.tune(cutoff * (1 + 3 * (bright[i] ?? 0)), 1.2);
    const target = gate[i] ?? 0;
    level += (target - level) * (target > level ? 0.012 : 0.0007);
    out[i] = lowpass.process((narrow[i] ?? 0) + 0.2 * (body[i] ?? 0)) * level;
  }
  return out;
}

/**
 * A warm sub bass note: a sine with a quiet second harmonic, gently saturated, under a low-passed
 * saw an octave up that small speakers can hear. It may slide in from `from` (a MIDI note).
 */
export function subBass(note: number, seconds: number, from = note): Float32Array {
  const glide = (t: number) => midiToHz(note + (from - note) * Math.exp(-t / 0.025));
  const out = oscillator('sine', glide, seconds);
  const second = oscillator('sine', (t) => 2 * glide(t), seconds);
  const grit = filter(
    oscillator('saw', (t) => 2 * glide(t), seconds),
    'lowpass',
    420,
    0.8,
  );
  for (let i = 0; i < out.length; i++) {
    const x = (out[i] ?? 0) + 0.22 * (second[i] ?? 0);
    out[i] = Math.tanh(1.6 * x) / Math.tanh(1.6) + 0.16 * (grit[i] ?? 0);
  }
  const envelope = arEnvelope(seconds, 0.006, Math.min(0.08, seconds / 3));
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * envelope(i / SAMPLE_RATE);
  return out;
}
