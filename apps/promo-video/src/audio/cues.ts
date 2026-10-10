/**
 * Where each sound effect lands. Every cue reads its moment from the timeline's sections and
 * choreography, so a keycap thocks on the frame it bottoms out and a card slams on its beat. This
 * file scores the film's frame (the opening shortcut, the chapter words, the models and the
 * closing shortcut); each chapter's interactions are scored in its own `cues-*.ts`.
 */
import { at, CHAPTER_TITLE, CHOREO, SECTIONS, type SectionId } from '../timeline.ts';
import { RING_START } from './arrangement.ts';
import { type Cues, createCues, type EffectBuses } from './cue-bus.ts';
import { cascade, glass, keyTick, pop, snap, swoosh, tine } from './effects.ts';
import { bloom, dropGlide, sparkle } from './effects-light.ts';
import { macroKey } from './effects-physical.ts';
import { impact } from './instruments.ts';
import { anythingCues } from './cues-anything.ts';
import { anytimeCues } from './cues-anytime.ts';
import { anywhereCues } from './cues-anywhere.ts';

/** ⌘, ⇧ and Space from left to right; Space is the biggest, deepest key. */
const KEY_SIZES = [1.1, 1.15, 1.35];
const KEY_PANS = [-0.35, 0, 0.35];

/**
 * The shortcut's three macro keycaps: deep, satisfying thocks. In the finale they come faster
 * and a touch lighter.
 */
function keycaps(cues: Cues, times: readonly number[], gain: number): void {
  times.forEach((time, i) =>
    cues.place(
      macroKey(cues.random, KEY_SIZES[i] ?? 1.2),
      time,
      gain * (i === times.length - 1 ? 1.15 : 1),
      KEY_PANS[i] ?? 0,
      0.15,
    ),
  );
}

/**
 * Two drops of light travel in from opposite corners, coral from the left and cyan from the right,
 * gliding up to a fifth apart, and lock into the mark with a glass chime, a glint and a shimmer.
 */
function dropsLock(cues: Cues, from: number, lock: number, gain: number): void {
  const seconds = lock - from;
  cues.place(tine(86, 0.6), from, gain * 0.6, -0.85, 0.8);
  cues.place(tine(81, 0.6), from + 0.04, gain * 0.5, 0.85, 0.8);
  cues.travel(
    dropGlide(cues.random, seconds, 74, 86),
    from,
    gain,
    (t) => -0.85 * Math.max(0, 1 - t / seconds),
    0.6,
  );
  cues.travel(
    dropGlide(cues.random, seconds, 69, 81),
    from,
    gain * 0.9,
    (t) => 0.85 * Math.max(0, 1 - t / seconds),
    0.6,
  );
  cues.place(snap(cues.random, 0.7), lock, gain * 1.6, 0, 0.3);
  cues.place(glass(86), lock, gain * 2.6, -0.1, 0.9);
  cues.place(glass(93), lock + 0.03, gain * 1.1, 0.15, 0.9);
  cues.place(sparkle(cues.random, 1.2, 28), lock + 0.02, gain * 0.9, 0.1, 0.7);
}

/**
 * A chapter word lands on its downbeat: a sub impact under a struck glass dyad, then air as the
 * camera flies through the word into the chapter.
 */
function chapterWord(
  cues: Cues,
  section: SectionId,
  notes: [number, number],
  weight: number,
): void {
  const start = SECTIONS[section].start + CHAPTER_TITLE.in;
  cues.place(impact(cues.random, weight), start, 0.085, 0, 0.45);
  cues.place(glass(notes[0]), start, 0.035, -0.2, 0.9);
  cues.place(glass(notes[1]), start + 0.02, 0.025, 0.2, 0.9);
  cues.place(
    swoosh(cues.random, 0.55, 380, 3400),
    SECTIONS[section].start + CHAPTER_TITLE.out - 0.3,
    0.12,
    0,
    0.4,
  );
}

function open(cues: Cues): void {
  const beat = (seconds: number) => at('open', seconds);
  const beats = CHOREO.open;
  keycaps(
    cues,
    beats.keys.map((key) => beat(key)),
    0.42,
  );
  cues.place(bloom(cues.random, 1.6), beat(beats.bloom), 0.13, 0.15, 0.6);
  dropsLock(cues, beat(beats.drops), beat(beats.mark), 0.05);
  cues.place(swoosh(cues.random, 0.6, 600, 2800), beat(beats.wordmark) - 0.1, 0.1, 0.25, 0.5);
  cues.place(swoosh(cues.random, 0.9, 500, 2400), beat(beats.tagline) - 0.1, 0.12, 0, 0.5);
  // Everything pushes past the camera into the light, arriving on the drop.
  const exit = beat(beats.exit);
  cues.place(swoosh(cues.random, SECTIONS.open.end - exit, 300, 5200), exit, 0.32, 0, 0.5);
}

/** The models orbit in on two rings, crossing the field both ways; the local ring lights. */
function yours(cues: Cues): void {
  const beat = (seconds: number) => at('yours', seconds);
  const beats = CHOREO.yours;
  const orbit = beats.local - beats.marks + 0.4;
  cues.travel(
    swoosh(cues.random, orbit, 300, 2200),
    beat(beats.marks),
    0.2,
    (t) => -0.8 + (1.6 * t) / orbit,
    0.5,
  );
  cues.travel(
    swoosh(cues.random, orbit, 420, 3000),
    beat(beats.marks) + 0.15,
    0.17,
    (t) => 0.8 - (1.6 * t) / orbit,
    0.5,
  );
  cues.place(cascade(cues.random, 6, 0.5, 74, 'up'), beat(beats.local), 0.08, 0, 0.7);
  cues.place(sparkle(cues.random, 0.6, 14), beat(beats.local) + 0.1, 0.025, 0.2, 0.6);
  cues.place(glass(78), beat(beats.promise), 0.025, 0, 0.9);
  const exit = beat(beats.exit);
  cues.place(swoosh(cues.random, SECTIONS.yours.end - exit, 300, 4200), exit, 0.22, 0, 0.4);
}

function finale(cues: Cues): void {
  const beat = (seconds: number) => at('finale', seconds);
  const beats = CHOREO.finale;
  cues.place(impact(cues.random, 0.8), SECTIONS.finale.start, 0.06, 0, 0.5);
  const keys = beats.keys.map((key) => beat(key));
  keycaps(cues, keys, 0.17);
  // The mark re-forms from the last key's light.
  dropsLock(cues, beat(beats.drops), beat(beats.mark), 0.04);
  cues.place(swoosh(cues.random, 0.6, 600, 2800), beat(beats.wordmark) - 0.1, 0.09, 0.2, 0.5);
  cues.place(swoosh(cues.random, 0.8, 500, 2200), beat(beats.line) - 0.1, 0.06, 0, 0.5);
  // The white "Download for Mac" key: a smaller keycap and a bright pop.
  cues.place(macroKey(cues.random, 0.8), beat(beats.cta), 0.11, 0, 0.2);
  cues.place(pop(86, cues.random), beat(beats.cta), 0.07, 0, 0.4);
  cues.patter(
    [beat(beats.url), beat(beats.url) + 0.4],
    0.05,
    (i) => keyTick(cues.random, 1.3 + 0.03 * i),
    0.04,
    0.1,
  );
  cues.place(pop(74, cues.random), beat(beats.specs), 0.04, -0.1, 0.4);
  // The last chord: a soft low bloom and a long glint as the picture fades.
  cues.place(impact(cues.random, 1.4), RING_START, 0.05, 0, 0.7);
  cues.place(sparkle(cues.random, 1.6, 20), beat(beats.fade), 0.02, 0, 0.8);
}

export function renderCues(): EffectBuses {
  const cues = createCues(11);
  open(cues);
  chapterWord(cues, 'anywhere', [81, 86], 0.9);
  anywhereCues(cues);
  chapterWord(cues, 'anything', [79, 86], 1);
  anythingCues(cues);
  chapterWord(cues, 'anytime', [78, 83], 1.3);
  anytimeCues(cues);
  yours(cues);
  finale(cues);
  return cues.buses;
}
