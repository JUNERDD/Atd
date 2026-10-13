/**
 * The choose section's beats, in seconds from its start (bar 8 on the film's clock, 19.2 s; the
 * section is bars 8–13, 0–12 s), on the 0.15 s grid except the write-back streams and the
 * submenu's 90 ms hover delay (product timing). Pure and DOM-free, so the score reads the same
 * times: `chooseKeys` is every key the picture presses, `chooseClicks` every click, and
 * `chooseWrites(lang)` every chunk the app types back.
 *
 * Bar 8, TAP: ⌥P tapped (released before 300 ms), Polish writing runs as last time and writes
 * back. Bars 9–10, HOLD: ⌥T held, the press capsule's meter charges for 0.3 s and the island
 * grows into Translate's options card; Space opens Target language, ↓↓ moves, 4 picks Japanese,
 * ↩ runs, the Japanese is written in place. Bars 11–12, WHERE: with the mouse, Translate's split
 * chevron opens its menu; When done lists the five destinations, the saved one "(default)";
 * "Insert after the selected text" is picked for this run only, and the answer lands after the
 * selection. Then the new text's selection floods the frame and clears to the bare dot field.
 */
import type { Lang } from '../../../copy.ts';
import { textUnits } from '../../../kit/world/text-units.ts';
import { bars, beats, steps } from '../../timeline.ts';
import { typeTimes } from '../../world/typing.ts';
import { content } from './content.ts';

export const CHOOSE_BEATS = {
  // ---- Bar 8: tap to run -------------------------------------------------------------------
  /** The Mac's screen rises out of the dot field (a soft white ring from its center). */
  screenIn: steps(1),
  /** The macro keycaps ⌥ P rise into the left column. */
  keysIn: steps(2),
  /** Beat 1: line 1 is selected (a quick sweep of the wash). */
  tapSelect: beats(1),
  /** ⌥ goes down a sixteenth early; P lands on beat 2; both are up 150 ms later (a tap). */
  tapMod: steps(7),
  tapKey: beats(2),
  tapUp: steps(9),
  /** The island: the press capsule on key-down, Running on release, Writing…, Written. */
  tapRun: steps(9),
  tapWrite: beats(3),
  tapDone: steps(14),
  /** "Tap to run." lands with the tap, a word per sixteenth. */
  tapWord: beats(2),
  tapWordOut: steps(15),

  // ---- Bars 9–10: hold to choose ------------------------------------------------------------
  /** The polished line is selected again. */
  holdSelect: steps(15),
  /** Bar 9's downbeat: ⌥ down; T a sixteenth later starts the hold (press capsule, meter). */
  holdMod: bars(1),
  holdKey: steps(17),
  /** 300 ms of charge, then the capsule grows into the options card (a sheet: two options). */
  cardOpen: steps(19),
  /** The shortcut's keys come up; the card keeps the keyboard. */
  holdUp: steps(22),
  /** Beat 6: Space opens Target language inside the card (a drill-down of eight languages). */
  drill: beats(6),
  /** ↓ ↓ move the highlight on beat 7 and its "and". */
  moves: [beats(7), steps(30)],
  /** Bar 10's downbeat: 4 picks Japanese; a sixteenth later the card is back on its sheet. */
  pick: bars(2),
  pickBack: steps(33),
  /** Beat 9: ↩ runs; beat 10: Writing…, the Japanese typed in place; then Written. */
  holdRun: beats(9),
  holdWrite: beats(10),
  holdDone: steps(42),
  /** Written stays 1.5 s (`CommandProgressState.doneDuration`), then the island leaves. */
  holdExit: steps(52),
  holdWordOut: steps(47),

  // ---- Bars 11–12: where it goes -------------------------------------------------------------
  /** The pointer glides in; the camera opens up for the menus. */
  pointerIn: beats(11),
  /** Bar 11's downbeat: ⌥ held, the pointer presses at line 2's start and drags across it. */
  dragStart: bars(3),
  dragEnd: steps(51),
  /** Mouse and ⌥ up: the selection toolbar grows out of the selection. */
  dragUp: steps(52),
  /** Beat 14: a click on Translate's split chevron opens its options menu. */
  chevronClick: beats(14),
  /** The pointer rests on When done; its submenu of destinations opens after 90 ms. */
  whenDoneHover: steps(58),
  submenuOpen: steps(58) + 0.09,
  /** Over into the submenu, then a click on "Insert after the selected text" (for this run). */
  submenuEnter: beats(15),
  pickClick: steps(62),
  /** A click on Run; the toolbar goes, the island runs, writes after the selection, Written. */
  runClick: steps(65),
  whereRun: steps(66),
  whereWrite: steps(69),
  whereDone: steps(71),
  /** "This time, put it here." lands word by word, its last word on the pick. */
  whereWordEnd: steps(62),
  /** Beat 19: the new text's selection floods the frame, solid at 11.7, clear by the cut. */
  flood: beats(19),
  floodLength: steps(2),
  floodRelease: 0.28,
  /** The cut to `yours` (31.2 s on the film's clock). */
  end: bars(5),
} as const;

const B = CHOOSE_BEATS;

/** One key on the macro keycaps: when it goes down and comes up. */
export interface ChooseKey {
  legend: string;
  down: number;
  up: number;
}

/**
 * Every key the picture presses, in order (for key-click sounds; `down` is the hit). The hold's
 * T stays down across the 0.3 s charge, the threshold that turns a tap into options.
 */
export const chooseKeys: readonly ChooseKey[] = [
  { legend: '⌥', down: B.tapMod, up: B.tapUp },
  { legend: 'P', down: B.tapKey, up: B.tapUp },
  { legend: '⌥', down: B.holdMod, up: B.holdUp },
  { legend: 'T', down: B.holdKey, up: B.holdUp },
  { legend: 'Space', down: B.drill, up: B.drill + 0.12 },
  { legend: '↓', down: B.moves[0], up: B.moves[0] + 0.08 },
  { legend: '↓', down: B.moves[1], up: B.moves[1] + 0.08 },
  { legend: '4', down: B.pick, up: B.pick + 0.08 },
  { legend: '↩', down: B.holdRun, up: B.holdRun + 0.1 },
  { legend: '⌥', down: B.dragStart, up: B.dragUp },
];

/** Every click of the pointer: the drag's press and release, chevron, the pick, and Run. */
export const chooseClicks = {
  dragDown: B.dragStart,
  dragUp: B.dragUp,
  chevron: B.chevronClick,
  pick: B.pickClick,
  run: B.runClick,
} as const;

/**
 * The island's morphs (for whooshes and the Written chime): each content change and when.
 * `press` starts the charge meter (a riser of exactly 0.3 s for the hold).
 */
export const chooseIsland = [
  { at: B.tapKey, kind: 'press' },
  { at: B.tapRun, kind: 'working' },
  { at: B.tapWrite, kind: 'writing' },
  { at: B.tapDone, kind: 'done' },
  { at: B.holdKey, kind: 'press' },
  { at: B.cardOpen, kind: 'card' },
  { at: B.drill, kind: 'drill' },
  { at: B.pickBack, kind: 'card' },
  { at: B.holdRun, kind: 'working' },
  { at: B.holdWrite, kind: 'writing' },
  { at: B.holdDone, kind: 'done' },
  { at: B.holdExit, kind: 'exit' },
  { at: B.whereRun, kind: 'working' },
  { at: B.whereWrite, kind: 'writing' },
  { at: B.whereDone, kind: 'done' },
] as const;

/**
 * Each write-back's chunk times at the app's shipped pace (4 characters per 20 ms), in order:
 * the polish, the Japanese in place, and the translation inserted after line 2.
 */
export function chooseWrites(lang: Lang): Record<'polish' | 'translate' | 'insert', number[]> {
  const c = content[lang];
  return {
    polish: typeTimes(c.polished, B.tapWrite, 'shipped'),
    translate: typeTimes(c.japanese, B.holdWrite, 'shipped'),
    insert: typeTimes(c.doorsJapanese, B.whereWrite, 'shipped'),
  };
}

/** Each unit's landing time: from `first` a sixteenth apart, or ending on `last`. */
function landings(text: string, lang: Lang, anchor: { first: number } | { last: number }) {
  const count = textUnits(text, lang).length;
  const start = 'first' in anchor ? anchor.first : anchor.last - (count - 1) * steps(1);
  return Array.from({ length: count }, (_, index) => start + index * steps(1));
}

/** When each word (zh: word group) of the three statements lands, for soft type hits. */
export function chooseWordTimes(lang: Lang): Record<'tap' | 'hold' | 'where', number[]> {
  const { words } = content[lang];
  return {
    tap: landings(words.tap, lang, { first: B.tapWord }),
    hold: landings(words.hold, lang, { last: B.cardOpen }),
    where: landings(words.where, lang, { last: B.whereWordEnd }),
  };
}
