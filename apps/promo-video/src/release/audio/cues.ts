/**
 * The release film's sound effects for one language's cut: every on-screen event of every
 * section, read from the scenes' own `beats.ts` so each sound lands on its frame. Typing differs
 * by language (the keystrokes are the picture's), so each cut gets its own effects. Cues sit inside
 * the music through `levelAt`; the drop, the finale's hit and the last chord are the score's.
 */
import { createCues, type Cues, type EffectBuses } from '../../audio/cue-bus.ts';
import { prng } from '../../audio/dsp.ts';
import type { Lang } from '../../copy.ts';
import { RELEASE_DURATION } from '../timeline.ts';
import { chooseSounds } from './sections/choose.ts';
import { everythingSounds } from './sections/everything.ts';
import { finaleSounds, openSounds } from './sections/open-finale.ts';
import { levelAt } from './sections/shared.ts';
import { writebackSounds } from './sections/writeback.ts';
import { yoursSounds } from './sections/yours.ts';

export function renderReleaseCues(lang: Lang): EffectBuses {
  const cues = createCues(80, { seconds: RELEASE_DURATION, levelAt });
  // Each section draws from its own seeded noise, so the sections without typing sound the same
  // in both cuts however many keystrokes came before them.
  const section = (seed: number): Cues => ({ ...cues, random: prng(seed) });
  openSounds(section(1), lang);
  writebackSounds(section(2), lang);
  chooseSounds(section(3), lang);
  yoursSounds(section(4));
  everythingSounds(section(5));
  finaleSounds(section(6), lang);
  return cues.buses;
}
