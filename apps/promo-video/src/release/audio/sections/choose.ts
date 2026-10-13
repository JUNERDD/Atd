/**
 * The choose section's cues: the screen rising, the macro keycaps (every press and release), the
 * selections' sweeps, the island's morphs (the press capsule, Running, Writing…, Written, the
 * options card and its drill-down), the hold's charge rising over exactly the 0.3 s meter, each
 * write-back's glitter, the pointer's clicks through the split button's menu, and the flood into
 * the cut.
 */
import type { Cues } from '../../../audio/cue-bus.ts';
import type { Lang } from '../../../copy.ts';
import {
  CHOOSE_BEATS,
  chooseClicks,
  chooseIsland,
  chooseKeys,
  chooseWrites,
} from '../../scenes/choose/beats.ts';
import { sectionStart } from '../../timeline.ts';
import { bloom, sweep, whoosh } from '../effects/motion.ts';
import { blip, click, keycap, pop, press } from '../effects/ui.ts';
import { tick } from '../instruments/kit.ts';
import { charge } from '../instruments/moments.ts';
import { rootAbove, writeBack, written } from './shared.ts';

/** The keycaps sit in the frame's left column; the note and its menus right of centre. */
const KEYS = -0.35;
const NOTE = 0.15;

/** How big each legend's keycap is (Space is the wide one). */
function size(legend: string): number {
  return legend === 'Space' ? 1.35 : legend === '↩' ? 1.15 : 1;
}

type IslandKind = (typeof chooseIsland)[number]['kind'];

/** One island morph: a blip for the press capsule and Writing…, a bloom for Running and the card. */
function islandCue(cues: Cues, time: number, kind: IslandKind, local: number): void {
  const b = CHOOSE_BEATS;
  switch (kind) {
    case 'press':
      cues.place(blip(rootAbove(time, 76), 0), time, 0.07, 0, 0.2);
      break;
    case 'working':
      cues.place(whoosh(0.22, cues.random), time - 0.05, 0.05, 0, 0.2);
      cues.place(bloom(rootAbove(time, 40), cues.random, 0.8), time, 0.1, 0, 0.3);
      break;
    case 'writing':
      cues.place(blip(rootAbove(time, 76)), time, 0.1, 0, 0.3);
      break;
    case 'done':
      // The last Written of the three runs is the fullest.
      written(cues, time, local === b.whereDone ? 0.15 : 0.12);
      break;
    case 'card': {
      const opening = local === b.cardOpen;
      const voice = bloom(rootAbove(time, 40), cues.random, opening ? 1.4 : 0.6);
      cues.place(voice, time, opening ? 0.15 : 0.08, 0, 0.4);
      break;
    }
    case 'drill':
      cues.place(pop(rootAbove(time, 78), cues.random), time, 0.09, 0, 0.3);
      break;
    case 'exit':
      cues.place(blip(rootAbove(time, 71), 7), time, 0.07, 0, 0.25);
      break;
  }
}

export function chooseSounds(cues: Cues, lang: Lang): void {
  const start = sectionStart('choose');
  const at = (local: number) => start + local;
  const b = CHOOSE_BEATS;

  cues.place(bloom(rootAbove(at(b.screenIn), 40), cues.random, 1.2), at(b.screenIn), 0.08, 0, 0.4);
  cues.place(tick(cues.random, 1.05), at(b.keysIn), 0.05, KEYS);
  cues.place(sweep(0.25, cues.random, 800, 3600), at(b.tapSelect), 0.07, NOTE, 0.3);
  cues.place(sweep(0.25, cues.random, 800, 3600), at(b.holdSelect), 0.06, NOTE, 0.3);

  for (const key of chooseKeys) {
    const accent = key.legend === 'P' || key.legend === '4' ? 1.15 : key.legend === '⌥' ? 0.8 : 1;
    cues.place(
      keycap(cues.random, 'press', size(key.legend)),
      at(key.down),
      0.34 * accent,
      KEYS,
      0.12,
    );
    cues.place(keycap(cues.random, 'release', size(key.legend)), at(key.up), 0.16, KEYS, 0.08);
  }
  // The hold: the charge rises over the meter's 0.3 s and stops dead as the card opens.
  const meter = b.cardOpen - b.holdKey;
  cues.place(charge(meter, cues.random, 73, 85), at(b.holdKey), 0.09, 0, 0.3);

  for (const { at: local, kind } of chooseIsland) islandCue(cues, start + local, kind, local);

  const writes = chooseWrites(lang);
  writeBack(cues, writes.polish, at(0), 0.09, [NOTE - 0.2, NOTE + 0.2]);
  writeBack(cues, writes.translate, at(0), 0.09, [NOTE - 0.2, NOTE + 0.2]);
  writeBack(cues, writes.insert, at(0), 0.09, [NOTE, NOTE + 0.3]);

  const c = chooseClicks;
  cues.place(press(cues.random, 'down'), at(c.dragDown), 0.26, NOTE);
  cues.travel(
    sweep(b.dragEnd - b.dragStart + 0.1, cues.random),
    at(c.dragDown),
    0.08,
    (t) => NOTE - 0.2 + t,
  );
  cues.place(press(cues.random, 'up'), at(c.dragUp), 0.2, NOTE);
  cues.place(pop(rootAbove(at(c.dragUp), 78), cues.random), at(c.dragUp) + 0.02, 0.1, NOTE, 0.3);
  cues.place(click(cues.random), at(c.chevron), 0.28, NOTE);
  cues.place(pop(rootAbove(at(c.chevron), 81), cues.random), at(c.chevron) + 0.03, 0.08, NOTE, 0.3);
  cues.place(
    pop(rootAbove(at(b.submenuOpen), 85), cues.random),
    at(b.submenuOpen),
    0.05,
    NOTE + 0.2,
    0.3,
  );
  cues.place(click(cues.random), at(c.pick), 0.34, NOTE + 0.2);
  cues.place(click(cues.random), at(c.run), 0.26, NOTE);
  cues.place(sweep(0.45, cues.random, 900, 6000), at(b.flood), 0.11, 0, 0.35);
}
