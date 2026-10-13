import type { Lang } from '../../../copy.ts';
import { CommandIsland } from '../../../kit/product/CommandIsland.tsx';
import { ISLAND_HOME } from '../../../kit/product/island.ts';
import type { IslandMoment, OptionsCardSpec } from '../../../kit/product/island-layout.ts';
import { OptionsMenu } from '../../../kit/product/OptionsMenu.tsx';
import { outputChoice } from '../../../kit/product/run-output.ts';
import { SelectionCapsule } from '../../../kit/product/SelectionCapsule.tsx';
import { Camera } from '../../../kit/world/Camera.tsx';
import { Cursor } from '../../../kit/world/Cursor.tsx';
import { clamp01 } from '../../../motion/ease.ts';
import { springAt, type Spring } from '../../../motion/spring.ts';
import type { Pulse } from '../../world/dots.ts';
import { Stage } from '../../world/Stage.tsx';
import { CHOOSE_BEATS as B } from './beats.ts';
import { content, PICKED_LANGUAGE, REMEMBERED_LANGUAGE } from './content.ts';
import { SCREEN, screenCamera } from './layout.ts';
import { NoteWindow } from './NoteWindow.tsx';
import { pointerAt, pointerPlan } from './pointer.ts';

/**
 * The island's two runs on the keyboard: the tap (press, Running, Writing…, Written) and the
 * hold (press with its charging meter, Translate's options card as a sheet, Target language
 * opened in it with ↓↓ and a pick of Japanese, back to the sheet, Running with the Japanese chip,
 * Writing…, Written).
 */
function keyboardRuns(lang: Lang): IslandMoment[] {
  const c = content[lang];
  const saved = outputChoice(lang, { saved: 'replaceSelection' });
  const remembered = c.languages[REMEMBERED_LANGUAGE] ?? '';
  const japanese = c.languages[PICKED_LANGUAGE] ?? '';
  const sheet = (language: string): OptionsCardSpec => ({
    title: c.translate,
    page: 'sheet',
    values: [c.languageLabel, saved.label],
    details: [language, saved.values[saved.current] ?? ''],
    current: -1,
    selected: 0,
  });
  const drill: OptionsCardSpec = {
    title: c.languageLabel,
    page: 'drill',
    values: c.languages,
    current: REMEMBERED_LANGUAGE,
    selected: REMEMBERED_LANGUAGE,
    moves: [
      { at: B.moves[0], to: REMEMBERED_LANGUAGE + 1 },
      { at: B.moves[1], to: REMEMBERED_LANGUAGE + 2 },
      { at: B.pick, to: PICKED_LANGUAGE },
    ],
  };
  return [
    { at: B.tapKey, content: { kind: 'press', command: c.polish } },
    { at: B.tapRun, content: { kind: 'working', command: c.polish } },
    { at: B.tapWrite, content: { kind: 'writing' } },
    { at: B.tapDone, content: { kind: 'done' } },
    { at: B.holdKey, content: { kind: 'press', command: c.translate } },
    { at: B.cardOpen, content: { kind: 'card', card: sheet(remembered) } },
    { at: B.drill, content: { kind: 'card', card: drill } },
    { at: B.pickBack, content: { kind: 'card', card: sheet(japanese) } },
    { at: B.holdRun, content: { kind: 'working', command: c.translate, summary: japanese } },
    { at: B.holdWrite, content: { kind: 'writing' } },
    { at: B.holdDone, content: { kind: 'done' } },
  ];
}

/** The mouse run: Running with the Japanese chip, Writing…, Written. */
function mouseRun(lang: Lang): IslandMoment[] {
  const c = content[lang];
  const japanese = c.languages[PICKED_LANGUAGE] ?? '';
  return [
    { at: B.whereRun, content: { kind: 'working', command: c.translate, summary: japanese } },
    { at: B.whereWrite, content: { kind: 'writing' } },
    { at: B.whereDone, content: { kind: 'done' } },
  ];
}

/** Rings through the wallpaper's dots as the island lands, opens into a card, and finishes. */
const STAGE_PULSES: readonly Pulse[] = [
  { ...ISLAND_HOME, at: B.tapRun, strength: 0.55 },
  { ...ISLAND_HOME, at: B.tapDone, strength: 0.5 },
  { ...ISLAND_HOME, at: B.cardOpen, strength: 0.9 },
  { ...ISLAND_HOME, at: B.holdDone, strength: 0.6 },
  { ...ISLAND_HOME, at: B.whereRun, strength: 0.55 },
  { ...ISLAND_HOME, at: B.whereDone, strength: 0.7 },
];

/** The window's arrival out of the dot field: a firm settle, no bounce to speak of. */
const ARRIVE: Spring = { response: 0.62, damping: 0.86 };

/**
 * The window onto the Mac, at `SCREEN` in the frame: rounded, edged with a hairline, floating
 * over the dot field. Through it the display is seen by its own camera, which reframes as the
 * card grows and pans with the pointer through the menus. Everything on the display is the
 * product as it ships: the glass note, the command island, the selection toolbar's split
 * buttons and the options menus with When done.
 */
export function Screen({ lang, t }: { lang: Lang; t: number }) {
  if (t < B.screenIn) return null;
  const arrive = springAt(t, B.screenIn, ARRIVE);
  const plan = pointerPlan(lang);
  const pointer = pointerAt(plan, t, lang);
  const c = content[lang];
  return (
    <div
      className="r08-choose__screen"
      style={{
        '--sx': SCREEN.x,
        '--sy': SCREEN.y,
        '--sw': SCREEN.width,
        '--sh': SCREEN.height,
        '--in': clamp01(arrive),
        '--rise': (1 - arrive) * 48,
        '--grow': 0.9 + 0.1 * arrive,
        '--blur': `${(1 - clamp01(arrive)) * 14}px`,
      }}
    >
      <div className="r08-choose__glass">
        <Camera state={screenCamera(lang, t)}>
          <Stage lang={lang} t={t} pulses={STAGE_PULSES}>
            <NoteWindow lang={lang} t={t} selection={pointer.selection} />
            <CommandIsland lang={lang} t={t} moments={keyboardRuns(lang)} exit={B.holdExit} />
            {t >= B.whereRun ? <CommandIsland lang={lang} t={t} moments={mouseRun(lang)} /> : null}
            {pointer.toolbar.shown ? (
              <div
                className="r08-choose__toolbar"
                style={{ '--x': plan.capsule.x, '--y': plan.capsule.y }}
              >
                <SelectionCapsule
                  lang={lang}
                  commands={[c.translate, c.polish]}
                  options="all"
                  more={false}
                  entrance={pointer.toolbar.age}
                  chevron={pointer.toolbar.chevron}
                  chevronAt={0}
                />
              </div>
            ) : null}
            {pointer.menu.shown ? (
              <OptionsMenu
                origin={plan.menu}
                items={pointer.menu.items}
                hover={pointer.menu.hover}
                pressed={pointer.menu.pressed}
                active={pointer.menu.active}
              />
            ) : null}
            {pointer.submenu.shown ? (
              <OptionsMenu
                origin={plan.submenu}
                items={plan.submenuItems}
                hover={pointer.submenu.hover}
                pressed={pointer.submenu.pressed}
              />
            ) : null}
            {pointer.cursorOpacity > 0 ? (
              <Cursor state={pointer.cursor} size={1.1} opacity={pointer.cursorOpacity} />
            ) : null}
          </Stage>
        </Camera>
      </div>
      <div className="r08-choose__edge" />
    </div>
  );
}
