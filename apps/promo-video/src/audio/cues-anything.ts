/**
 * "Anything": a task worked end to end in the panel (typing, the plan, subagents, tool cards,
 * approval, the answer), a habit tracker built, opened and pinned, and the three tools the agent
 * makes on request slamming in.
 */
import { at, CHOREO } from '../timeline.ts';
import type { Cues } from './cue-bus.ts';
import { cascade, glass, keyTick, mouseClick, pop, snap, swoosh, thud, tine } from './effects.ts';
import { sparkle } from './effects-light.ts';
import { slam, spring } from './effects-physical.ts';

const beat = (seconds: number) => at('anything', seconds);

/** Todos tick up the D major pentatonic, one step higher each. */
const TODO_NOTES = [74, 76, 78, 81, 86];

/** Keystrokes across a typing span, given in absolute seconds. */
export function typing(cues: Cues, span: readonly number[]): void {
  const [from, to] = span;
  cues.patter(
    [from ?? 0, to ?? 0],
    0.06,
    () => keyTick(cues.random, 0.95 + 0.08 * cues.random()),
    0.08,
  );
}

/** The prompt leaves the composer: a quick upward swish and a bright pop. */
function send(cues: Cues, time: number): void {
  cues.place(swoosh(cues.random, 0.25, 900, 3600), time - 0.05, 0.1, 0, 0.3);
  cues.place(pop(81, cues.random), time, 0.07, 0, 0.3);
}

/** A rising note with a click: a todo ticked, a habit checked, a tool confirmed. */
function check(cues: Cues, time: number, note: number, gain: number, position = 0): void {
  cues.place(tine(note, 0.8), time, gain, position, 0.5);
  cues.place(snap(cues.random, 1.2), time, gain * 0.5, position, 0.1);
}

function work(cues: Cues): void {
  const beats = CHOREO.anything.work;
  typing(cues, beats.typing.map(beat));
  send(cues, beat(beats.send));
  cues.place(pop(74, cues.random), beat(beats.plan), 0.06, 0, 0.3);
  cues.place(cascade(cues.random, 5, 0.25, 74, 'up'), beat(beats.plan) + 0.05, 0.025, 0, 0.5);
  // Two subagent chips, a sixteenth apart.
  cues.place(pop(78, cues.random), beat(beats.subagents), 0.06, -0.2, 0.3);
  cues.place(pop(81, cues.random), beat(beats.subagents) + 0.125, 0.06, 0.2, 0.3);
  beats.tools.forEach((tool, i) => {
    cues.place(pop([66, 69, 71][i] ?? 69, cues.random), beat(tool), 0.07, -0.25 + 0.25 * i, 0.3);
    cues.place(thud(cues.random), beat(tool), 0.025, -0.25 + 0.25 * i, 0.05);
  });
  // The approval card asks: two notes falling, like a question waiting.
  const approval = beat(beats.approval);
  cues.place(swoosh(cues.random, 0.3, 700, 2200), approval - 0.08, 0.08, 0, 0.3);
  cues.place(pop(81, cues.random), approval, 0.07, 0, 0.35);
  cues.place(pop(76, cues.random), approval + 0.14, 0.06, 0, 0.35);
  cues.place(mouseClick(cues.random), beat(beats.allow), 0.15, 0.15, 0.1);
  cues.place(glass(81), beat(beats.allow) + 0.02, 0.025, 0.15, 0.9);
  const [answerFrom, answerTo] = beats.answer.map((s) => beat(s));
  cues.patter(
    [answerFrom ?? 0, answerTo ?? 0],
    0.07,
    (i) => snap(cues.random, 1 + 0.05 * (i % 3)),
    0.03,
    0.1,
  );
  beats.todos.forEach((todo, i) =>
    check(cues, beat(todo), TODO_NOTES[i] ?? 86, 0.05, -0.3 + 0.15 * i),
  );
  cues.place(pop(79, cues.random), beat(beats.saved), 0.08, 0.2, 0.3);
  cues.place(sparkle(cues.random, 0.4, 10), beat(beats.saved) + 0.03, 0.025, 0.2, 0.5);
}

function app(cues: Cues): void {
  const beats = CHOREO.anything.app;
  typing(cues, beats.typing.map(beat));
  send(cues, beat(beats.send));
  const build = beat(beats.build);
  const built = beat(beats.built);
  cues.place(pop(71, cues.random), build, 0.06, 0, 0.3);
  // Build progress: air rising under ticks that climb, an eighth apart.
  cues.place(swoosh(cues.random, built - build, 300, 3000), build, 0.06, 0, 0.3);
  const steps = Math.round((built - build) / 0.125);
  for (let i = 1; i < steps; i++) {
    cues.place(snap(cues.random, 0.8 + (0.6 * i) / steps), build + i * 0.125, 0.025, 0.1, 0.1);
  }
  cues.place(glass(86), built, 0.03, 0, 0.9);
  cues.place(pop(81, cues.random), built, 0.06, 0, 0.3);
  // The app window springs out of the panel onto the desktop.
  const open = beat(beats.open);
  cues.travel(swoosh(cues.random, 0.4, 500, 3800), open - 0.05, 0.18, (t) => 0.4 - t, 0.4);
  cues.place(spring(cues.random, 74), open, 0.08, -0.1, 0.35);
  beats.use.forEach((use, i) =>
    check(cues, beat(use), [81, 83, 86][i] ?? 86, 0.06, -0.2 + 0.2 * i),
  );
  // The card is picked up and dragged out, landing on the wallpaper as a pin.
  cues.place(mouseClick(cues.random), beat(beats.pin), 0.1, 0, 0.05);
  cues.place(swoosh(cues.random, 0.5, 600, 1600), beat(beats.pin) + 0.05, 0.06, 0, 0.2);
  cues.place(thud(cues.random), beat(beats.pinned), 0.14, -0.3, 0.2);
  cues.place(pop(62, cues.random), beat(beats.pinned), 0.05, -0.3, 0.3);
}

function tools(cues: Cues): void {
  const beats = CHOREO.anything.tools;
  // A command, a skill and an automation slam in, each a step higher, and each confirms.
  beats.cards.forEach((card, i) => {
    const note = [62, 66, 69][i] ?? 69;
    const position = -0.3 + 0.3 * i;
    cues.place(slam(cues.random, note), beat(card), 0.13, position, 0.3);
    check(cues, beat(card) + beats.confirm, note + 24, 0.05, position);
  });
  // The camera pulls out with the automation card, falling toward the night.
  cues.place(swoosh(cues.random, 1, 2400, 300), beat(beats.pullOut), 0.2, 0, 0.5);
}

export function anythingCues(cues: Cues): void {
  work(cues);
  app(cues);
  tools(cues);
}
