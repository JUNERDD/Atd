/**
 * The yours section's cues, light over the breakdown: a breath of air on each vignette's cut, the
 * sign-in click and the plan dialog's glass chime, the Effort menu's pops and its highlight
 * stepping up the chord as a tiny arpeggio, the pick, the light run's send and its answer landing
 * in a quick glint, then the long press, the lift, the drag with the rows making way, the drop, and
 * the caret wipe into `everything`.
 */
import type { Cues } from '../../../audio/cue-bus.ts';
import { YOURS_BEATS, yoursCues } from '../../scenes/yours/beats.ts';
import { sectionStart } from '../../timeline.ts';
import { shimmer, sweep, whoosh } from '../effects/motion.ts';
import { blip, chime, click, keystroke, pop, press, thunk } from '../effects/ui.ts';
import { tick } from '../instruments/kit.ts';
import { rootAbove } from './shared.ts';

/** The Effort highlight's five steps climb Eadd9 (the bar's chord): E, F♯, G♯, B, E. */
const STEP_NOTES = [76, 78, 80, 83, 88];

export function yoursSounds(cues: Cues): void {
  const start = sectionStart('yours');
  const at = (local: number) => start + local;
  const b = YOURS_BEATS;
  const all = yoursCues();

  for (const cut of all.cuts) cues.place(whoosh(0.35, cues.random), at(cut) - 0.05, 0.03, 0, 0.4);
  // The plan: the click, then "You're using your ChatGPT plan" opens with a glass chime.
  cues.place(click(cues.random), at(b.plan.press), 0.24, 0.1);
  const dialog = rootAbove(at(b.plan.dialog), 85);
  cues.place(chime([dialog, dialog + 3], 0.05, 0.4), at(b.plan.dialog), 0.08, 0, 0.5);
  // Effort: the trigger opens the menu, the highlight steps up, ↩ picks High.
  cues.place(click(cues.random), at(b.effort.open), 0.22, -0.1);
  cues.place(
    pop(rootAbove(at(b.effort.open), 78), cues.random),
    at(b.effort.open) + 0.03,
    0.08,
    -0.1,
    0.3,
  );
  b.effort.steps.forEach((step, index) => {
    cues.place(blip(STEP_NOTES[index] ?? 88, 0), at(step), 0.07, -0.1 + 0.05 * index, 0.25);
  });
  cues.place(keystroke(cues.random, 0.9, 1.3), at(b.effort.pick), 0.3, -0.1, 0.1);
  // The light run: ↩ sends, the answer lands almost at once.
  cues.place(keystroke(cues.random, 0.9, 1.4), at(b.light.send), 0.3, 0.1, 0.1);
  const answer = b.light.done - b.light.answer;
  cues.place(
    shimmer(answer, cues.random, [80, 83, 85, 88, 92]),
    at(b.light.answer),
    0.06,
    0.1,
    0.4,
  );
  // Your order: press and hold, the shadow rises, the row lifts, drags, makes way, drops.
  cues.place(press(cues.random, 'down'), at(b.order.press), 0.22, 0);
  cues.place(
    sweep(b.order.lift - b.order.shadow, cues.random, 300, 1400),
    at(b.order.shadow),
    0.07,
    0,
    0.3,
  );
  cues.place(whoosh(b.order.dragLength + 0.1, cues.random), at(b.order.drag), 0.06, 0, 0.2);
  for (const local of all.ticks.slice(b.effort.steps.length)) {
    cues.place(tick(cues.random, 0.9), at(local), 0.06, 0.05);
  }
  cues.place(press(cues.random, 'up'), at(b.order.drop), 0.18, 0);
  cues.place(thunk(cues.random, rootAbove(at(b.order.drop), 47)), at(b.order.drop), 0.2, 0, 0.2);
  cues.travel(
    whoosh(b.wipeLength, cues.random),
    at(b.wipe),
    0.1,
    (t) => -0.8 + (1.6 * t) / b.wipeLength,
  );
}
