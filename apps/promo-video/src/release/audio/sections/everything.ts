/**
 * The everything section's cues: a soft key per word of the lead line, the swell as it leaves,
 * then the mosaic: a light flip per fill tile, a heavier flip with a plucked chord tone per hero
 * tile (the words' dotted-quarter pulse across the four-on-the-floor), a whoosh into each whip, the
 * brand tiles turning; then the pull-back revealing "0.8", the decimal point's landing, the glint
 * crossing the digits, the point rising into the caret and every tile converging into the hit.
 */
import type { Cues } from '../../../audio/cue-bus.ts';
import {
  BRAND_TURNS,
  EVERYTHING_BEATS,
  TILE_ARRIVALS,
  WORD_HITS,
} from '../../scenes/everything/beats.ts';
import { sectionStart } from '../../timeline.ts';
import { bloom, flip, shimmer, whoosh } from '../effects/motion.ts';
import { keystroke, pop, thunk } from '../effects/ui.ts';
import { stringPluck } from '../instruments/keys.ts';
import { swell } from '../instruments/moments.ts';
import { chordAt } from '../music/harmony.ts';
import { rootAbove } from './shared.ts';

/** The glint climbs E major's pentatonic over two octaves. */
const GLINT = [80, 83, 85, 88, 90, 92, 95, 97, 100];

export function everythingSounds(cues: Cues): void {
  const start = sectionStart('everything');
  const at = (local: number) => start + local;
  const b = EVERYTHING_BEATS;

  for (const local of b.lead) cues.place(keystroke(cues.random, 1.05), at(local), 0.22, 0, 0.1);
  cues.place(whoosh(0.6, cues.random), at(b.leadOut), 0.06, 0, 0.3);

  for (const [id, local] of Object.entries(TILE_ARRIVALS)) {
    if (id === 'point') continue;
    const time = at(local);
    const pan = 0.5 * Math.sin(local * 2.7);
    const hero = WORD_HITS.indexOf(local);
    if (hero >= 0) {
      cues.place(flip(cues.random, true), time, hero === 0 ? 0.07 : 0.1, pan, 0.15);
      const arp = chordAt(time + 1e-3).arp;
      const note = arp[hero % arp.length] ?? 80;
      const voice = stringPluck(note, 0.9, cues.random, {
        seconds: 0.9,
        ring: 0.8,
        brightness: 0.8,
      });
      cues.place(voice, time, hero === 0 ? 0.06 : 0.08, pan, 0.3);
    } else {
      cues.place(flip(cues.random), time, 0.07, pan, 0.1);
    }
  }
  for (const time of WORD_HITS.slice(1)) {
    cues.place(whoosh(0.28, cues.random), at(time) - 0.3, 0.04, 0, 0.15);
  }
  for (const turns of Object.values(BRAND_TURNS)) {
    for (const local of turns ?? []) cues.place(flip(cues.random), at(local), 0.045, 0.3, 0.1);
  }

  // The reveal: the camera pulls back on "0.8", the point lands, the glint, the caret, converge.
  cues.place(whoosh(0.9, cues.random, false), at(b.pullback), 0.1, 0, 0.4);
  cues.place(bloom(rootAbove(at(b.pullback), 33), cues.random, 2), at(b.pullback), 0.14, 0, 0.5);
  cues.place(thunk(cues.random, rootAbove(at(b.point), 47)), at(b.point), 0.22, 0.05, 0.2);
  cues.place(pop(rootAbove(at(b.point), 83), cues.random), at(b.point), 0.1, 0.05, 0.4);
  cues.travel(
    shimmer(b.glintLength, cues.random, GLINT),
    at(b.glint),
    0.08,
    (t) => -0.6 + (1.2 * t) / b.glintLength,
    0.5,
  );
  cues.place(whoosh(b.morphLength + 0.05, cues.random), at(b.morph), 0.08, 0, 0.3);
  // The swell stops with the score's breath, so the hit lands on a moment of silence.
  const converge = at(b.end) - 0.15 - at(b.converge);
  cues.place(swell(converge, cues.random), at(b.converge), 0.1, 0, 0.2);
}
