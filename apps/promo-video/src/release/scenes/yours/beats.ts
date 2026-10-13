/**
 * The yours section's beats, in seconds from its start (bar 13 on the film's clock; the section is
 * bars 13–17, 31.2–40.8 s), snapped to the 0.15 s grid. Pure and DOM-free, so the score reads the
 * same times (`atRelease('yours', YOURS_BEATS.effort.pick)` → 33.6).
 *
 * Four one-bar vignettes, each cut in on its bar line: the ChatGPT plan (bar 13), effort per
 * command (bar 14), a light run (bar 15) and the Commands list reordered by long press (bar 16).
 * Each statement's first line rises a sixteenth after the cut; its second line lands on the
 * vignette's payoff (the dialog, the pick, the answer, the drop). Bar 16's last beat is the caret
 * wipe onto the bare dot field, which ends on the cut to `everything` at 9.6 s.
 */
import { bars, steps } from '../../timeline.ts';
import type { Vignette } from './content.ts';

/** Where each vignette starts: its bar line, a hard cut (a white ring leaves the shot's focus). */
export const VIGNETTE_START = {
  plan: bars(0),
  effort: bars(1),
  light: bars(2),
  order: bars(3),
} as const satisfies Record<Vignette, number>;

/** Each statement's timing: the first line, the second line (the payoff), and the exit. */
export interface WordBeats {
  /** The first line's words rise (each a 32nd after the last). */
  first: number;
  /** The second line lands with the vignette's payoff. */
  payoff: number;
  /** Both lines rise out (omitted: they stay, and the wipe takes them). */
  out?: number;
}

export const YOURS_BEATS = {
  /** Bar 13 · Models → Sign in to OpenAI. */
  plan: {
    /** The form fades up out of the bare field (the section's frame 0 is the field alone). */
    in: VIGNETTE_START.plan,
    /** The pointer clicks "Continue with ChatGPT" (beat 2): soft click, coral fleck. */
    press: steps(4),
    /** The button reads "Signing in…" and Cancel turns into "Cancel sign-in". */
    signingIn: steps(5),
    /** Beat 3: "You're using your ChatGPT plan" opens over the window (fade + zoom, 0.12 s). */
    dialog: steps(8),
    words: { first: steps(1), payoff: steps(8), out: steps(14) },
  },
  /** Bar 14 · the command editor's Effort select. */
  effort: {
    in: VIGNETTE_START.effort,
    /** The pointer clicks the trigger ("Use connection default"); the menu opens on it. */
    open: VIGNETTE_START.effort + steps(2),
    /** ↓ steps the highlight one item each sixteenth: Off, Minimal, Low, Medium, High. */
    steps: [3, 4, 5, 6, 7].map((n) => VIGNETTE_START.effort + steps(n)),
    /** Beat 3: ↩ picks "High"; the menu closes and the trigger reads it. */
    pick: VIGNETTE_START.effort + steps(8),
    words: {
      first: VIGNETTE_START.effort + steps(1),
      payoff: VIGNETTE_START.effort + steps(8),
      out: VIGNETTE_START.effort + steps(14),
    },
  },
  /** Bar 15 · a light run in the task panel: the answer lands a sixteenth after it is sent. */
  light: {
    in: VIGNETTE_START.light,
    /** ↩ sends the draft (Send dips); the message rises into the transcript. */
    send: VIGNETTE_START.light + steps(2),
    /** Two sixteenths later the answer is already streaming. */
    answer: VIGNETTE_START.light + steps(4),
    /** Fully written three sixteenths after that; Stop turns back into Send. */
    done: VIGNETTE_START.light + steps(7),
    words: {
      first: VIGNETTE_START.light + steps(1),
      payoff: VIGNETTE_START.light + steps(4),
      out: VIGNETTE_START.light + steps(14),
    },
  },
  /** Bar 16 · Settings → Commands: long-press "Translate", drag it up two places, drop. */
  order: {
    in: VIGNETTE_START.order,
    /** The pointer presses the row (the hold starts). */
    press: VIGNETTE_START.order + steps(1),
    /** The product's hold: the shadow rises 120 ms in over 230 ms; the row lifts at 350 ms. */
    shadow: VIGNETTE_START.order + steps(1) + 0.12,
    lift: VIGNETTE_START.order + steps(1) + 0.35,
    /** The drag, beat 2 to just before beat 3: up two rows, the rows it passes making way. */
    drag: VIGNETTE_START.order + steps(4),
    dragLength: steps(3),
    /** Beat 3: released, dropped in place (the order is saved). */
    drop: VIGNETTE_START.order + steps(8),
    words: { first: VIGNETTE_START.order + steps(1), payoff: VIGNETTE_START.order + steps(8) },
  },
  /** Bar 16, beat 4: the caret wipe sets off; it ends on the cut to `everything` at 9.6 s. */
  wipe: bars(4) - steps(4),
  wipeLength: steps(4),
  /** The section's end, the cut. */
  end: bars(4),
} as const;

/** The dragged row's travel, 0 → 1 (cubic ease in and out, as a hand drags). */
export function dragProgress(t: number): number {
  const { drag, dragLength } = YOURS_BEATS.order;
  const p = Math.min(1, Math.max(0, (t - drag) / dragLength));
  return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
}

/** How far the dragged row travels, in rows. */
export const DRAG_ROWS = 2;

/**
 * When the dragged row's middle passes each row it overtakes (the nearer first), so that row
 * slides down a place: the moments the reorder ticks.
 */
export function makeWayTimes(): number[] {
  const { drag, dragLength } = YOURS_BEATS.order;
  return Array.from({ length: DRAG_ROWS }, (_, index) => {
    const target = (index + 0.5) / DRAG_ROWS;
    let lo = drag;
    let hi = drag + dragLength;
    for (let step = 0; step < 32; step++) {
      const mid = (lo + hi) / 2;
      if (dragProgress(mid) < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  });
}

/**
 * Every moment the score can hit in this section, in section-local seconds, by kind: cuts (bar
 * lines), clicks and keys (presses, picks, sends, the drop), soft ticks (select steps, rows making
 * way), arrivals (the dialog, the answer) and the statements' lines.
 */
export function yoursCues() {
  const b = YOURS_BEATS;
  return {
    cuts: Object.values(VIGNETTE_START),
    clicks: [b.plan.press, b.effort.open, b.effort.pick, b.light.send, b.order.press, b.order.drop],
    ticks: [...b.effort.steps, ...makeWayTimes()],
    lift: b.order.lift,
    arrivals: [b.plan.dialog, b.light.answer],
    firstLines: [
      b.plan.words.first,
      b.effort.words.first,
      b.light.words.first,
      b.order.words.first,
    ],
    payoffs: [
      b.plan.words.payoff,
      b.effort.words.payoff,
      b.light.words.payoff,
      b.order.words.payoff,
    ],
    wipe: { at: b.wipe, length: b.wipeLength },
  };
}
