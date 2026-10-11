/**
 * The release score's one-off moments, placed on the picture's own beats: the caret's pulse on its
 * two idle blinks, the retype's rising strings and the swell into the drop, the two hits and the
 * lighter one under the "0.8" reveal, the charges under choose's hold and its menu, the riser into
 * the finale, and the pulse lead's hook where it is stated (the drop, choose, the finale).
 */
import { addMono, type Stereo } from '../../../audio/dsp.ts';
import type { MusicBuses } from '../../../audio/master.ts';
import { CHOOSE_BEATS } from '../../scenes/choose/beats.ts';
import { EVERYTHING_BEATS } from '../../scenes/everything/beats.ts';
import { OPEN_BEATS } from '../../scenes/open/beats.ts';
import { bars, sectionStart, STEP } from '../../timeline.ts';
import { stringPluck } from '../instruments/keys.ts';
import { leadLine } from '../instruments/lead.ts';
import { caretPulse, charge, hit, swell } from '../instruments/moments.ts';
import { HOOK, hookNotes } from './harmony.ts';
import { HITS } from './parts.ts';

/** The caret's idle blinks before it types (the open is section 0, so local time is film time). */
const PULSES = OPEN_BEATS.blinks;
/** The retype (bar 1, beat 3): a run up C♯ minor in thirty-seconds, done before the breath. */
const RETYPE = OPEN_BEATS.retype;
const RETYPE_RUN = [64, 68, 71, 73, 76, 80];
const CHOOSE = sectionStart('choose');
/**
 * Charges under choose, [start, end, from, to]: from ⌥ going down to the options card opening
 * (the effects add the meter's own 0.3 s charge on top), and from the chevron's click to the pick.
 */
const CHARGES = [
  [CHOOSE + CHOOSE_BEATS.holdMod, CHOOSE + CHOOSE_BEATS.cardOpen, 61, 68],
  [CHOOSE + CHOOSE_BEATS.chevronClick, CHOOSE + CHOOSE_BEATS.pickClick, 64, 71],
] as const;
/** The camera pulls back and the tiles turn out to spell "0.8". */
const REVEAL = sectionStart('everything') + EVERYTHING_BEATS.pullback;

/** The opening: the caret's pulse, the retype's run and the swell, all into the drop's breath. */
export function opening(buses: MusicBuses, random: () => number): void {
  for (const [index, at] of PULSES.entries()) {
    const gain = index === 0 ? 0.2 : 0.16 - 0.012 * index;
    const voice = caretPulse(85);
    addMono(buses.dry, voice, at, gain, 0);
    addMono(buses.send, voice, at, gain * 0.4, 0);
  }
  for (const [index, note] of RETYPE_RUN.entries()) {
    const at = RETYPE + index * (STEP / 2);
    const voice = stringPluck(note, 0.9, random, {
      seconds: HITS[0] - 0.15 - at,
      ring: 1.2,
      brightness: 0.8,
    });
    const position = -0.5 + index * 0.2;
    addMono(buses.dry, voice, at, 0.12, position);
    addMono(buses.send, voice, at, 0.06, position);
  }
  const rise = swell(HITS[0] - RETYPE, random, 0.15);
  addMono(buses.dry, rise, RETYPE, 0.16, 0);
  addMono(buses.send, rise, RETYPE, 0.1, 0);
}

/**
 * The drop and the finale's hit, each ducking the music like a kick, and a lighter one under the
 * "0.8" reveal that keeps well below them.
 */
export function hits(buses: MusicBuses, random: () => number): void {
  const all = [
    [HITS[0], 1.1, 0.62],
    [REVEAL, 0.55, 0.26],
    [HITS[1], 1.4, 0.62],
  ] as const;
  for (const [at, weight, gain] of all) {
    const voice = hit(random, weight);
    addMono(buses.dry, voice, at, gain, 0);
    addMono(buses.send, voice, at, gain * 0.4, 0);
    buses.kicks.push(at);
  }
}

/** The hold charges under choose and the long riser out of everything into the finale. */
export function risers(buses: MusicBuses, random: () => number): void {
  for (const [start, end, from, to] of CHARGES) {
    const voice = charge(end - start, random, from, to);
    addMono(buses.dry, voice, start, 0.07, 0.1);
    addMono(buses.send, voice, start, 0.05, 0.1);
  }
  const end = HITS[1] - 0.15;
  const climb = charge(end - bars(21), random, 59, 83);
  addMono(buses.dry, climb, bars(21), 0.08, 0);
  addMono(buses.send, climb, bars(21), 0.05, 0);
  const air = swell(HITS[1] - bars(20), random, 0.15);
  addMono(buses.dry, air, bars(20), 0.15, 0);
  addMono(buses.send, air, bars(20), 0.08, 0);
}

/** Where the pulse lead states the hook: its phrase, its start, and how legato it is played. */
const STATEMENTS = [
  [HOOK.phrase, bars(2), 0.92],
  [HOOK.phrase, bars(8), 0.92],
  [HOOK.finale, bars(22), 1],
] as const;

/** The hook on the pulse lead, into its own bus (the score adds its echo). */
export function hook(bus: Stereo): void {
  for (const [phrase, start, legato] of STATEMENTS) {
    const notes = hookNotes(phrase, 0, legato);
    const voice = leadLine(notes, { cutoff: start === bars(22) ? 2600 : 2200 });
    addMono(bus, voice, start, 0.12, 0);
  }
}
