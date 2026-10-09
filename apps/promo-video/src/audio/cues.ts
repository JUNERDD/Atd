/**
 * Where each sound effect lands: every cue reads its moment from the timeline and the scenes'
 * choreography, so a pop sounds on the frame its bubble appears and a click on its keystroke.
 */
import { keystrokeTimes } from '../dots/typing.ts';
import {
  BAR,
  CASE_LENGTH,
  CASES_START,
  caseStart,
  CHOREO,
  DURATION,
  FEATURES,
  INTRO,
  OUTRO,
  PRIVACY,
  STAGE,
} from '../timeline.ts';
import { addMono, prng, stereo, type Stereo } from './dsp.ts';
import {
  glass,
  keyPress,
  keyTick,
  mouseClick,
  pop,
  powerOn,
  shutter,
  sparkle,
  swoosh,
} from './effects.ts';
import { impact, riser } from './instruments.ts';

/** About +6 dB for cues that play over the groove. */
const UNDER_THE_BEAT = 2;

export interface EffectBuses {
  dry: Stereo;
  send: Stereo;
}

export function renderCues(): EffectBuses {
  const random = prng(11);
  const buses: EffectBuses = { dry: stereo(DURATION), send: stereo(DURATION) };
  // Under the beat a cue needs more level to read through the music than over the quiet intro.
  const place = (voice: Float32Array, at: number, gain: number, position = 0, wet = 0.25) => {
    const level = gain * (at >= CASES_START - 0.5 ? UNDER_THE_BEAT : 1);
    addMono(buses.dry, voice, at, level, position);
    if (wet > 0) addMono(buses.send, voice, at, level * wet, position);
  };
  const ticks = (at: number, count: number, step: number, gain: number) => {
    for (let i = 0; i < count; i++)
      place(keyTick(random, 1.5 + 0.08 * i), at + i * step, gain, 0.2, 0.1);
  };

  // The display: power-on, the name lighting, every keystroke of the words, the dissolve and the
  // cursor opening into the screen.
  place(powerOn(random), 0, 0.16, 0, 0.5);
  place(glass(81), 0.62, 0.07, -0.2, 0.9);
  place(glass(86), 0.78, 0.05, 0.25, 0.9);
  for (const change of INTRO.changes) {
    const { erase, type } = keystrokeTimes(change.from, change.to);
    erase.forEach((at, i) =>
      place(keyTick(random, 0.86 - 0.01 * i), change.at + at, 0.2, -0.05, 0.08),
    );
    type.forEach((at, i) =>
      place(
        keyTick(random, 0.95 + 0.06 * random()),
        change.at + at,
        0.24,
        0.05 * ((i % 3) - 1),
        0.08,
      ),
    );
  }
  place(swoosh(random, 0.9, 500, 2400), INTRO.tagline - 0.1, 0.06, 0, 0.4);
  place(sparkle(random, 0.65, 70), INTRO.dissolve, 0.11, 0, 0.6);
  const riseFrom = INTRO.dissolve - 0.5;
  place(riser(CASES_START - riseFrom, random), riseFrom, 0.09, 0, 0.5);
  place(swoosh(random, 0.75, 260, 3200), INTRO.morph - 0.05, 0.2, 0.15, 0.5);
  place(impact(random, 0.8), CASES_START, 0.17, 0, 0.45);

  // The tour.
  const at = caseStart;
  CHOREO.summon.keys.forEach((key, i) =>
    place(keyPress(random), at('summon') + key, 0.34, -0.45 + i * 0.1, 0.12),
  );
  place(
    swoosh(random, 0.55, 420, 1900),
    at('summon') + CHOREO.summon.panel - 0.05,
    0.16,
    0.5,
    0.35,
  );
  place(pop(79, random), at('chat') + CHOREO.chat.ask, 0.2, 0.5, 0.3);
  place(pop(74, random), at('chat') + CHOREO.chat.status, 0.07, 0.4, 0.3);
  for (let line = 0; line < 3; line++)
    place(sparkle(random, 0.4, 9), at('chat') + CHOREO.chat.answer + line * 0.3, 0.05, 0.45, 0.3);
  place(swoosh(random, 0.5, 1800, 380), at('chat') + CASE_LENGTH - 0.38, 0.13, 0.4, 0.3);
  place(
    swoosh(random, 0.45, 2200, 5200),
    at('selection') + CHOREO.selection.highlight,
    0.07,
    0.1,
    0.2,
  );
  place(pop(81, random), at('selection') + CHOREO.selection.toolbar, 0.2, 0, 0.35);
  place(
    swoosh(random, 0.6, 1400, 220),
    at('screenshot') + CHOREO.screenshot.dim - 0.1,
    0.1,
    0,
    0.3,
  );
  place(
    swoosh(random, 0.45, 900, 4200),
    at('screenshot') + CHOREO.screenshot.select,
    0.08,
    -0.2,
    0.2,
  );
  CHOREO.screenshot.steps.forEach((step, i) =>
    place(pop(76 + i * 3, random), at('screenshot') + step, 0.16, -0.2 + i * 0.2, 0.3),
  );
  place(sparkle(random, 0.3, 14), at('screenshot') + CHOREO.screenshot.mosaic, 0.05, -0.3, 0.2);
  place(shutter(random), at('screenshot') + CHOREO.screenshot.capture, 0.3, 0, 0.25);
  place(swoosh(random, 0.5, 2600, 700), at('mini') + CHOREO.mini.rail, 0.12, 0.7, 0.3);
  place(pop(78, random), at('mini') + CHOREO.mini.menu, 0.1, 0.6, 0.3);
  place(mouseClick(random), at('mini') + CHOREO.mini.click, 0.3, 0.5, 0.1);
  for (const [id, beats, rows] of [
    ['models', CHOREO.models, 6],
    ['automations', CHOREO.automations, 7],
  ] as const) {
    place(swoosh(random, 0.6, 320, 2600), at(id) + beats.window - 0.05, 0.14, 0.1, 0.35);
    ticks(at(id) + beats.rows, rows, 0.075, 0.07);
  }
  place(swoosh(random, 0.55, 380, 2000), at('apps') + CHOREO.apps.list, 0.14, -0.4, 0.35);
  place(swoosh(random, 0.5, 600, 4200), at('apps') + CHOREO.apps.launch - 0.04, 0.15, 0.2, 0.4);

  // The screen falls away into the features, the privacy ring lights, the display returns.
  place(swoosh(random, 0.9, 1600, 160), STAGE.exit, 0.14, 0, 0.4);
  place(impact(random, 0.6), FEATURES.start, 0.12, 0, 0.5);
  for (let tile = 0; tile < 4; tile++) {
    const tileAt = FEATURES.start + FEATURES.tiles + tile * FEATURES.stagger;
    place(pop(69 + tile * 2, random), tileAt, 0.12, -0.45 + tile * 0.3, 0.35);
    place(sparkle(random, 0.35, 10), tileAt + 0.22, 0.04, -0.45 + tile * 0.3, 0.5);
  }
  place(impact(random, 0.5), PRIVACY.start, 0.1, 0, 0.6);
  place(sparkle(random, 0.9, 40), PRIVACY.start + PRIVACY.ring, 0.06, 0, 0.7);
  PRIVACY.nevers.forEach((never, i) =>
    place(pop(74 + i * 2, random), PRIVACY.start + never, 0.13, -0.3 + i * 0.3, 0.35),
  );
  place(riser(2 * BAR - 0.2, random), PRIVACY.end - 2 * BAR + 0.2, 0.1, 0, 0.5);
  place(impact(random, 1.1), OUTRO.start, 0.16, 0, 0.55);
  place(powerOn(random), OUTRO.start, 0.07, 0, 0.5);
  place(glass(86), OUTRO.start + 0.75, 0.04, 0, 0.9);
  OUTRO.keys.forEach((key, i) =>
    place(keyPress(random), OUTRO.start + key, 0.3, -0.2 + i * 0.2, 0.12),
  );
  place(pop(81, random), OUTRO.start + OUTRO.button, 0.18, 0, 0.35);
  ticks(OUTRO.start + OUTRO.button + 0.25, 8, 0.06, 0.12);
  place(impact(random, 1.4), OUTRO.fade - 0.8, 0.09, 0, 0.7);
  return buses;
}
