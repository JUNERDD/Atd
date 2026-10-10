/**
 * "Anywhere": the selection capsule and its translation, the screenshot freeze and annotation, the
 * mini panel catching a file, and the summoned panel the camera dives into.
 */
import { at, CHOREO, SECTIONS } from '../timeline.ts';
import type { Cues } from './cue-bus.ts';
import { keyPress, mouseClick, pop, shutter, snap, swoosh, thud } from './effects.ts';
import { sparkle } from './effects-light.ts';
import { freeze, spring, squash, stretch } from './effects-physical.ts';

const beat = (seconds: number) => at('anywhere', seconds);

/** The panel docks bottom-right, so its sounds sit right of center. */
const PANEL = 0.5;

function selection(cues: Cues): void {
  const beats = CHOREO.anywhere.selection;
  const [dragFrom, dragTo] = beats.drag.map((s) => beat(s));
  const from = dragFrom ?? beat(beats.start);
  const drag = (dragTo ?? from) - from;
  // The highlight grows with the drag: a soft swipe rising as it moves left to right.
  cues.travel(
    swoosh(cues.random, drag, 1600, 5200),
    from,
    0.2,
    (t) => -0.3 + (0.6 * t) / drag,
    0.2,
  );
  cues.place(mouseClick(cues.random), from, 0.05, -0.3, 0.05);
  cues.place(pop(81, cues.random), beat(beats.toolbar), 0.1, 0.1, 0.35);
  cues.place(sparkle(cues.random, 0.35, 8), beat(beats.toolbar) + 0.03, 0.02, 0.1, 0.5);
  cues.place(mouseClick(cues.random), beat(beats.click), 0.14, 0.1, 0.1);
  cues.place(swoosh(cues.random, 0.55, 420, 1900), beat(beats.panel) - 0.05, 0.18, PANEL, 0.35);
  const [streamFrom, streamTo] = beats.stream.map((s) => beat(s));
  cues.patter(
    [streamFrom ?? 0, streamTo ?? 0],
    0.075,
    (i) => snap(cues.random, 1.1 + 0.04 * (i % 4)),
    0.03,
    PANEL,
  );
}

function screenshot(cues: Cues): void {
  const beats = CHOREO.anywhere.screenshot;
  // The ⌘ ⇧ 2 hint: a small keycap, not the shortcut's macro keys.
  beats.keys.forEach((key, i) =>
    cues.place(keyPress(cues.random), beat(key), 0.13, -0.15 + i * 0.05, 0.12),
  );
  cues.place(freeze(cues.random), beat(beats.freeze), 0.13, 0, 0.35);
  beats.hover.forEach((hover, i) =>
    cues.place(snap(cues.random, 0.9 + 0.08 * i), beat(hover), 0.05, -0.2 + 0.15 * i, 0.15),
  );
  // The scroll grows the box: a ratchet of snaps climbing under a little air.
  const grow = beat(beats.grow);
  for (let i = 0; i < 5; i++) {
    cues.place(snap(cues.random, 0.8 + 0.1 * i), grow + i * 0.05, 0.03, 0.1, 0.1);
  }
  cues.place(swoosh(cues.random, 0.35, 900, 2800), grow, 0.07, 0.1, 0.2);
  cues.place(mouseClick(cues.random), beat(beats.select), 0.13, 0.1, 0.1);
  cues.place(pop(78, cues.random), beat(beats.toolbar), 0.08, 0, 0.35);
  // The spotlight darkens the rest: air sinking under a low pop.
  cues.place(swoosh(cues.random, 0.45, 2400, 600), beat(beats.spotlight), 0.12, -0.15, 0.4);
  cues.place(pop(69, cues.random), beat(beats.spotlight), 0.05, -0.15, 0.3);
  // Step badges pop up the scale.
  beats.steps.forEach((step, i) =>
    cues.place(pop([78, 81, 83][i] ?? 81, cues.random), beat(step), 0.1, -0.2 + 0.25 * i, 0.3),
  );
  const done = beat(beats.done);
  cues.place(shutter(cues.random), done, 0.24, 0, 0.25);
  // The capture shrinks and flies into the composer.
  cues.travel(
    swoosh(cues.random, 0.4, 2600, 700),
    done + 0.12,
    0.13,
    (t) => PANEL * (t / 0.4),
    0.3,
  );
}

function mini(cues: Cues): void {
  const beats = CHOREO.anywhere.mini;
  const edge = 0.7;
  // The glass pill appears on the screen's right edge.
  cues.place(pop(83, cues.random), beat(beats.start), 0.05, edge, 0.35);
  cues.place(mouseClick(cues.random), beat(beats.pickup), 0.08, -0.2, 0.05);
  cues.place(swoosh(cues.random, 0.3, 700, 1800), beat(beats.pickup), 0.06, -0.2, 0.1);
  // The pill stretches toward the file like liquid, swelling into the drop card.
  const magnet = beat(beats.magnet);
  const reach = beat(beats.drop) - magnet + 0.15;
  cues.travel(stretch(cues.random, reach), magnet, 0.11, (t) => edge - (0.3 * t) / reach, 0.35);
  // The drop: the file lets go into the card, which absorbs it and squashes back to the edge.
  cues.place(pop(66, cues.random), beat(beats.drop), 0.08, edge - 0.2, 0.3);
  cues.place(thud(cues.random), beat(beats.drop), 0.05, edge - 0.2, 0.1);
  cues.place(squash(cues.random), beat(beats.settle), 0.12, edge, 0.3);
}

function summon(cues: Cues): void {
  const beats = CHOREO.anywhere.summon;
  beats.keys.forEach((key, i) =>
    cues.place(keyPress(cues.random), beat(key), 0.17, -0.1 + 0.1 * i, 0.12),
  );
  cues.place(swoosh(cues.random, 0.55, 380, 2000), beat(beats.panel) - 0.05, 0.2, PANEL, 0.35);
  cues.place(spring(cues.random, 74), beat(beats.panel), 0.08, PANEL, 0.35);
  // The dive: a whoosh that rushes into the next chapter's downbeat.
  const dive = beat(beats.dive);
  cues.place(swoosh(cues.random, SECTIONS.anywhere.end - dive, 250, 6000), dive, 0.3, 0, 0.5);
}

export function anywhereCues(cues: Cues): void {
  selection(cues);
  screenshot(cues);
  mini(cues);
  summon(cues);
}
