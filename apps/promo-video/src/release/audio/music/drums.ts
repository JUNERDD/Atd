/**
 * The release score's drums, a bar at a time, from sixteen-step patterns: `x` is a full hit, `o`
 * a ghost. Typing ticks fill the sixteenths the hats leave empty, so the sound of writing is the
 * rhythm. Every kick is reported for the sidechain. The last two sixteenths before the finale's
 * hit are left empty so it lands on a breath.
 */
import { addMono } from '../../../audio/dsp.ts';
import type { MusicBuses } from '../../../audio/master.ts';
import { bars, STEP } from '../../timeline.ts';
import { crash, hat, kick, shaker, snare, tick } from '../instruments/kit.ts';
import { FORM, type Groove } from './form.ts';

export interface Pattern {
  kick: string;
  snare: string;
  hat: string;
  open: string;
  shaker: string;
}

const EMPTY = '................';

/** Each groove's sixteen steps per voice. */
export const PATTERNS: Record<Groove, Pattern> = {
  none: { kick: EMPTY, snare: EMPTY, hat: EMPTY, open: EMPTY, shaker: EMPTY },
  a: {
    kick: 'x......x..x.....',
    snare: '....x.......x...',
    hat: 'o.x.o.x.o.x.o.x.',
    open: EMPTY,
    shaker: EMPTY,
  },
  b: {
    kick: 'x......xx.x...o.',
    snare: '....x.......x..o',
    hat: 'xoxoxo.oxoxoxo.o',
    open: '......x.......x.',
    shaker: '..o...o...o...o.',
  },
  light: {
    kick: 'o...............',
    snare: '............o...',
    hat: '..o...o...o...o.',
    open: EMPTY,
    shaker: 'o.x.o.x.o.x.o.x.',
  },
  lift: {
    kick: 'x......xx.x.....',
    snare: '....x.......xoxx',
    hat: 'xoxoxo.oxoxo....',
    open: '......x.........',
    shaker: EMPTY,
  },
  four: {
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: 'xo.oxo.oxo.oxo.o',
    open: '..x...x...x...x.',
    shaker: EMPTY,
  },
  roll: {
    kick: 'x...x...x...x...',
    snare: 'o.o.o.o.xoxoxx..',
    hat: 'xxxxxxxxxxxx....',
    open: EMPTY,
    shaker: EMPTY,
  },
  last: { kick: 'x...............', snare: EMPTY, hat: EMPTY, open: EMPTY, shaker: EMPTY },
};

/** Bars that open with a crash (bar 21: the "0.8" reveal). */
const CRASHES = new Set([2, 8, 17, 21, 22, 24]);
/** A light swing on the off sixteenths, in seconds. */
const SWING = 0.008;

/** The time of step `i` of a bar, the off sixteenths a little late. */
export function stepAt(bar: number, i: number): number {
  return bars(bar) + i * STEP + (i % 2 === 1 ? SWING : 0);
}

function velocity(pattern: string, i: number): number {
  const mark = pattern[i];
  return mark === 'x' ? 1 : mark === 'o' ? 0.45 : 0;
}

/** Renders one bar of drums into the dry bus (and a little into the reverb send). */
export function drumBar(buses: MusicBuses, bar: number, random: () => number): void {
  const feel = FORM[bar];
  if (!feel) return;
  const pattern = PATTERNS[feel.groove];
  const hitLevel = feel.groove === 'light' ? 0.3 : feel.groove === 'last' ? 0.55 : 0.44;
  if (CRASHES.has(bar)) {
    const voice = crash(random);
    const gain = bar === 24 ? 0.06 : 0.09;
    addMono(buses.dry, voice, bars(bar), gain, 0.15);
    addMono(buses.send, voice, bars(bar), gain * 0.5, 0.15);
  }
  for (let i = 0; i < 16; i++) {
    const at = stepAt(bar, i);
    const k = velocity(pattern.kick, i);
    if (k > 0) {
      addMono(buses.dry, kick(random, feel.groove === 'last' ? 1.5 : 1), at, hitLevel * k);
      buses.kicks.push(at);
    }
    const s = velocity(pattern.snare, i);
    if (s > 0) {
      const voice = snare(random);
      const level = (feel.groove === 'light' ? 0.14 : 0.26) * s;
      addMono(buses.dry, voice, at, level, -0.06);
      addMono(buses.send, voice, at, level * 0.35, -0.06);
    }
    const h = velocity(pattern.hat, i);
    if (h > 0) addMono(buses.dry, hat(random), at, 0.16 * h, 0.28);
    const o = velocity(pattern.open, i);
    if (o > 0) addMono(buses.dry, hat(random, true), at, 0.11 * o, 0.32);
    const sh = velocity(pattern.shaker, i);
    if (sh > 0) addMono(buses.dry, shaker(random), at - 0.01, 0.09 * sh, -0.38);
    const empty = h === 0 && o === 0 && sh === 0;
    if (feel.ticks > 0 && empty && i % 2 === 1) {
      const voice = tick(random, 0.85 + 0.3 * random());
      addMono(
        buses.dry,
        voice,
        at + 0.006,
        feel.ticks * (0.7 + 0.3 * random()),
        0.4 * random() - 0.2,
      );
    }
  }
}
