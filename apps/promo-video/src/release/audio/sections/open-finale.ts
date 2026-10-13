/**
 * The cues of the film's two caret scenes. The open: the rough line typed by a person, the
 * selection's sweep, the polished line written back as glitter, the version slamming in a
 * sixteenth after the drop, the title line typed and the caret wipe. The finale: the caret's
 * grow, the mark typed and its glint, the wordmark, Return and the tagline, the shortcut's keys
 * rising and pressed as a chord, the address typed under the last chord, and a last shimmer. The
 * drop, the hit and the last chord themselves are the score's.
 */
import type { Cues } from '../../../audio/cue-bus.ts';
import type { Lang } from '../../../copy.ts';
import { FINALE_BEATS, finaleKeystrokes } from '../../scenes/finale/beats.ts';
import { OPEN_BEATS, openKeystrokes } from '../../scenes/open/beats.ts';
import { sectionStart } from '../../timeline.ts';
import { bloom, shimmer, slam, sweep, whoosh } from '../effects/motion.ts';
import { chime, keycap, keystroke } from '../effects/ui.ts';
import { tick } from '../instruments/kit.ts';
import { typing, writeBack } from './shared.ts';

export function openSounds(cues: Cues, lang: Lang): void {
  const keys = openKeystrokes(lang);
  const b = OPEN_BEATS;
  typing(cues, keys.rough, 0, 0.42, -0.08);
  cues.place(sweep(b.selectLength + 0.15, cues.random, 600, 3400), b.select, 0.1, 0, 0.3);
  writeBack(cues, keys.polished, 0, 0.11, [-0.3, 0.3]);
  cues.place(slam(cues.random), b.version, 0.2, 0.1, 0.3);
  typing(cues, keys.titleLine, 0, 0.36, 0.05);
  cues.travel(
    whoosh(b.wipeLength, cues.random),
    b.wipe,
    0.13,
    (t) => -0.8 + (1.6 * t) / b.wipeLength,
  );
}

/** The finale's glint: E6 to G♯6, the major third of the last key. */
const GLINT = [88, 92];
/** The shortcut's keys from left to right: ⌘, ⇧, Space (wider and deeper). */
const CHORD_KEYS = [
  { size: 1, pan: -0.3 },
  { size: 1.05, pan: 0 },
  { size: 1.3, pan: 0.3 },
];

export function finaleSounds(cues: Cues, lang: Lang): void {
  const at = (local: number) => sectionStart('finale') + local;
  const keys = finaleKeystrokes(lang);
  const b = FINALE_BEATS;
  cues.place(bloom(52, cues.random, 1.4), at(b.grow), 0.12, 0, 0.5);
  cues.place(keystroke(cues.random, 0.8, 1.5), at(b.mark), 0.5, 0, 0.15);
  cues.place(chime(GLINT, 0.08, 0.7), at(b.mark) + 0.39, 0.09, 0.15, 0.6);
  typing(cues, keys.word, at(0), 0.4);
  cues.place(keystroke(cues.random, 0.85, 1.8), at(b.ret), 0.42, 0, 0.12);
  typing(cues, keys.line, at(0), 0.32, 0.04);
  CHORD_KEYS.forEach(({ size, pan }, index) => {
    cues.place(tick(cues.random, 1.1), at(b.keys) + index * 0.08, 0.05, pan);
    cues.place(keycap(cues.random, 'press', size), at(b.chord) + index * 0.03, 0.42, pan, 0.15);
    cues.place(keycap(cues.random, 'release', size), at(b.chordUp) + index * 0.02, 0.22, pan, 0.1);
  });
  typing(cues, keys.url, at(0), 0.26, 0);
  cues.place(shimmer(0.6, cues.random, [88, 92, 95, 100]), at(b.ring) + 0.05, 0.035, 0, 0.7);
}
