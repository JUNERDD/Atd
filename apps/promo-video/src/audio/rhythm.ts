/**
 * The score's drums and bass, a bar at a time, in the style its part asks for: a light, nimble
 * groove for "Anywhere", more drive for "Anything", a half-time night, the beat returning for
 * memory, a build into the finale and one last downbeat under the final chord.
 */
import { at, BAR, BEAT, CHOREO } from '../timeline.ts';
import { type BarPlan, breathes, FEEL } from './arrangement.ts';
import { addMono } from './dsp.ts';
import { bassNote, clap, hat, kick, rim } from './instruments.ts';
import type { MusicBuses } from './score.ts';

/** The camera pulls out of the last "Anything" bar into the night: the groove stops here. */
const PULL_OUT = at('anything', CHOREO.anything.tools.pullOut);

export function rhythm(buses: MusicBuses, bar: BarPlan, random: () => number): void {
  const style = FEEL[bar.part].drums;
  const root = bar.chord.root;
  const thump = (start: number, gain: number) => {
    addMono(buses.dry, kick(random), start, gain);
    buses.kicks.push(start);
  };
  const bass = (start: number, note: number, seconds: number, gain: number) =>
    addMono(buses.ducked, bassNote(note, seconds), start, gain);
  const hand = (start: number, gain: number, wet: number, position = -0.1) => {
    const voice = clap(random);
    addMono(buses.dry, voice, start, gain, position);
    addMono(buses.send, voice, start, gain * wet, position);
  };
  const tick = (start: number, gain: number, position: number, open = false) =>
    addMono(buses.dry, hat(random, open), start, gain, position);

  if (style === 'none') return;
  if (style === 'last') {
    thump(bar.start, 0.44);
    bass(bar.start, root, BAR, 0.2);
    return;
  }

  for (let beat = 0; beat < 4; beat++) {
    const beatAt = bar.start + beat * BEAT;
    const offbeat = beatAt + BEAT / 2;
    if (breathes(bar) && beat === 3) continue;
    if (bar.part === 'lift' && beatAt >= PULL_OUT) continue;

    switch (style) {
      case 'light': {
        thump(beatAt, 0.4);
        bass(offbeat, root, BEAT * 0.42, 0.18);
        tick(offbeat, 0.055, 0.25);
        if (beat % 2 === 1) addMono(buses.dry, rim(random), beatAt, 0.045, -0.2);
        // The second half of the chapter fills in with sixteenth ticks.
        if (bar.nth >= bar.count / 2) {
          tick(beatAt + BEAT / 4, 0.014, -0.3);
          tick(beatAt + (3 * BEAT) / 4, 0.012, 0.35);
        }
        break;
      }
      case 'drive':
      case 'full': {
        thump(beatAt, 0.44);
        bass(offbeat, root, BEAT * 0.4, 0.22);
        // A pickup an octave up drives into the next beat.
        bass(beatAt + (3 * BEAT) / 4, root + 12, BEAT * 0.18, 0.09);
        tick(offbeat, 0.068, 0.25, beat === 3 && bar.nth % 2 === 1);
        tick(beatAt + BEAT / 4, 0.018, -0.3);
        tick(beatAt + (3 * BEAT) / 4, 0.016, 0.35);
        if (beat % 2 === 1) hand(beatAt, 0.11, 0.9);
        break;
      }
      case 'half': {
        // Half time: the kick on one and the "and" of two, the clap on three, the bass held long.
        if (beat === 0) {
          thump(beatAt, 0.34);
          bass(beatAt, root, BEAT * 1.4, 0.15);
        }
        if (beat === 1) {
          thump(offbeat, 0.22);
          bass(offbeat, root, BEAT * 0.4, 0.1);
        }
        if (beat === 2) hand(beatAt, 0.07, 2.2, 0.1);
        tick(beatAt, 0.016, -0.25);
        tick(offbeat, 0.026, 0.25);
        // Dawn: sixteenths creep in as the light comes back.
        if (bar.part === 'dawn') {
          const swell = 0.006 + (0.016 * (beat + 1)) / 4;
          tick(beatAt + BEAT / 4, swell, -0.35);
          tick(beatAt + (3 * BEAT) / 4, swell, 0.35);
        }
        break;
      }
      case 'return': {
        thump(beatAt, 0.34);
        bass(offbeat, root, BEAT * 0.42, 0.16);
        tick(offbeat, 0.05, 0.25);
        break;
      }
      case 'build': {
        // The kick doubles from half notes to quarters for the second bar.
        if (bar.nth > 0 || beat % 2 === 0) thump(beatAt, 0.36 + 0.06 * bar.nth);
        bass(beatAt, root, BEAT * 0.3, 0.13 + 0.04 * bar.nth);
        // Claps roll in eighths, then sixteenths, swelling toward the finale's downbeat.
        const hits = bar.nth === 0 ? 2 : 4;
        for (let hit = 0; hit < hits; hit++) {
          const progress = (bar.nth * 4 + beat + hit / hits) / (bar.count * 4);
          hand(beatAt + (hit * BEAT) / hits, 0.03 + 0.11 * progress ** 1.5, 0.6, 0);
        }
        tick(offbeat, 0.04, 0.25);
        break;
      }
    }
  }
}
