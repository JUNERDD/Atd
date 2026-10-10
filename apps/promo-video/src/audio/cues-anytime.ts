/**
 * "Anytime": the night time-lapse (a clock ticking ever faster, the display idling, files dropping
 * into the watched folder, the automation running, dawn and the morning's notifications), then
 * memory: a correction remembered and used later on its own.
 */
import { at, CHOREO } from '../timeline.ts';
import type { Cues } from './cue-bus.ts';
import { typing } from './cues-anything.ts';
import { glass, pop, swoosh, thud, tine } from './effects.ts';
import { bloom, droplet, powerDown, sparkle } from './effects-light.ts';
import { clockTick } from './effects-physical.ts';

const beat = (seconds: number) => at('anytime', seconds);

/** The menu bar's clock, status item and notifications sit top-right. */
const MENU_BAR = 0.6;

/**
 * The clock races from dusk to dawn: its ticks start a quarter second apart and close up toward
 * a blur, alternating tick and tock.
 */
function clock(cues: Cues, from: number, to: number): void {
  const slowest = 0.25;
  const fastest = 0.05;
  let time = from;
  for (let i = 0; time < to; i++) {
    const progress = (time - from) / (to - from);
    cues.place(clockTick(cues.random, i % 2 === 1), time, 0.05 + 0.025 * progress, MENU_BAR, 0.15);
    time += slowest * (fastest / slowest) ** progress;
  }
}

function timelapse(cues: Cues): void {
  const beats = CHOREO.anytime.timelapse;
  const [from, to] = beats.clock.map((s) => beat(s));
  clock(cues, from ?? beat(beats.start), to ?? beat(beats.dawn));
  cues.place(powerDown(cues.random, 1), beat(beats.idle), 0.15, 0, 0.4);
  // Files land in the watched folder: soft drops, each a different note of the chord.
  beats.files.forEach((file, i) => {
    cues.place(droplet(cues.random, [81, 78, 83, 76][i] ?? 81), beat(file), 0.07, -0.35, 0.45);
    cues.place(thud(cues.random), beat(file), 0.025, -0.35, 0.1);
  });
  cues.place(pop(74, cues.random), beat(beats.run), 0.06, MENU_BAR, 0.3);
  cues.place(sparkle(cues.random, 0.6, 12), beat(beats.run) + 0.04, 0.02, MENU_BAR, 0.6);
  cues.place(bloom(cues.random, 1.4), beat(beats.dawn), 0.11, 0, 0.6);
  // Morning notifications slide in, each a gentle two-note glass chime.
  beats.notices.forEach((notice, i) => {
    const [low, high] = i === 0 ? [81, 86] : [78, 83];
    cues.place(swoosh(cues.random, 0.25, 1200, 3200), beat(notice) - 0.1, 0.05, MENU_BAR, 0.2);
    cues.place(glass(low), beat(notice), 0.04, MENU_BAR, 0.8);
    cues.place(glass(high), beat(notice) + 0.09, 0.032, MENU_BAR + 0.1, 0.8);
  });
}

function memory(cues: Cues): void {
  const beats = CHOREO.anytime.memory;
  cues.place(swoosh(cues.random, 0.4, 400, 2000), beat(beats.start) - 0.1, 0.09, 0, 0.3);
  typing(cues, beats.typing.map(beat));
  cues.place(swoosh(cues.random, 0.22, 900, 3600), beat(beats.correct) - 0.05, 0.08, 0, 0.3);
  cues.place(pop(76, cues.random), beat(beats.correct), 0.085, 0, 0.3);
  // "Remembered": the memory chip lands with a pop, a glass note and a glint.
  cues.place(pop(81, cues.random), beat(beats.remembered), 0.07, 0.1, 0.3);
  cues.place(glass(88), beat(beats.remembered) + 0.02, 0.035, 0.1, 0.9);
  cues.place(sparkle(cues.random, 0.5, 12), beat(beats.remembered) + 0.03, 0.022, 0.1, 0.6);
  // Later, the answer's units light up on their own: a pair of high tines.
  cues.place(tine(86, 0.7), beat(beats.later), 0.06, -0.1, 0.6);
  cues.place(tine(90, 0.7), beat(beats.later) + 0.12, 0.05, 0.1, 0.6);
}

export function anytimeCues(cues: Cues): void {
  timelapse(cues);
  memory(cues);
}
