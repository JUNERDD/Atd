/**
 * The writeback section's cues: the note window easing in, ⌥ and the drag with its selection
 * sweep, the toolbar's pop, the click on Polish writing and the camera's dive to the island, the
 * island's bloom and morph, the camera racing back up, the answer written back as glitter,
 * "Written", the island's retreat, then the montage's four cuts with their short write-backs, the
 * answer card, "Copied" and the selection flooding into the cut.
 */
import type { Cues } from '../../../audio/cue-bus.ts';
import type { Lang } from '../../../copy.ts';
import {
  DESTINATIONS,
  WRITEBACK_BEATS,
  WRITEBACK_CLICKS,
  WRITEBACK_ISLAND,
  WRITEBACK_MONTAGE,
  writebackKeystrokes,
} from '../../scenes/writeback/beats.ts';
import { sectionStart } from '../../timeline.ts';
import { bloom, flip, sweep, whoosh } from '../effects/motion.ts';
import { blip, click, keystroke, pop, press } from '../effects/ui.ts';
import { copied, rootAbove, writeBack, written } from './shared.ts';

/** Where things sit across the field: the note's text left of centre, the island at the bottom centre. */
const NOTE = -0.2;

export function writebackSounds(cues: Cues, lang: Lang): void {
  const start = sectionStart('writeback');
  const at = (local: number) => start + local;
  const b = WRITEBACK_BEATS;
  const island = WRITEBACK_ISLAND;
  const keys = writebackKeystrokes(lang);

  cues.place(whoosh(0.7, cues.random), at(b.windowIn), 0.05, 0, 0.3);
  cues.place(keystroke(cues.random, 0.8, 1.2), at(b.optionDown), 0.22, NOTE);
  for (const { at: local, kind } of WRITEBACK_CLICKS) {
    const voice = kind === 'click' ? click(cues.random) : press(cues.random, kind);
    cues.place(voice, at(local), kind === 'up' ? 0.22 : 0.3, NOTE);
  }
  const drag = b.dragUp - b.dragDown;
  cues.travel(sweep(drag, cues.random), at(b.dragDown), 0.09, (t) => NOTE - 0.2 + (0.4 * t) / drag);
  cues.place(pop(rootAbove(at(b.toolbar), 78), cues.random), at(b.toolbar), 0.12, NOTE, 0.3);
  cues.place(whoosh(0.5, cues.random, false), at(b.cameraDown) + 0.04, 0.08, 0, 0.2);

  cues.place(
    bloom(rootAbove(at(island.working), 40), cues.random),
    at(island.working),
    0.16,
    0,
    0.4,
  );
  cues.place(blip(rootAbove(at(island.writing), 76)), at(island.writing), 0.12, 0, 0.3);
  cues.place(whoosh(0.3, cues.random), at(b.cameraUp), 0.07, 0, 0.2);
  writeBack(cues, keys.answer, at(0), 0.1, [NOTE - 0.2, NOTE + 0.3]);
  written(cues, at(island.done), 0.14);
  cues.place(blip(rootAbove(at(island.out), 71), 7), at(island.out), 0.08, 0, 0.25);

  // The montage: a soft cut on each half bar, each destination's answer written back.
  for (const demo of WRITEBACK_MONTAGE)
    cues.place(flip(cues.random, true), at(demo.at), 0.1, 0, 0.2);
  DESTINATIONS.forEach((id, index) => {
    const side = (index - 1) * 0.25;
    writeBack(cues, keys.demos[id], at(0), 0.085, [side - 0.1, side + 0.1]);
  });
  cues.place(
    bloom(rootAbove(at(island.card), 40), cues.random, 1.5),
    at(island.card),
    0.16,
    0,
    0.4,
  );
  copied(cues, at(island.copied) + 0.03, 0.1, 0.1);
  cues.place(sweep(0.4, cues.random, 900, 6000), at(b.flood), 0.11, 0, 0.35);
}
