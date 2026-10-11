import type { Lang } from '../../copy.ts';
import { Keycaps } from '../world/Keycaps.tsx';
import type { Point } from '../world/points.ts';
import { CommandIsland } from './CommandIsland.tsx';
import type { IslandContent, IslandMoment } from './island-layout.ts';
import { menuFrame, menuItemRects, MENU, type MenuItem } from './options-menu.ts';
import { OptionsMenu } from './OptionsMenu.tsx';
import { outputChoice, outputMenuItems, outputMenuRow } from './run-output.ts';
import { SelectionCapsule } from './SelectionCapsule.tsx';
import { sheet08 } from './sheet-content-08.ts';
import { fill, strings } from './strings.ts';

/** An island at rest showing one content, standing on `anchor` (the middle of its bottom edge). */
function Still({
  lang,
  anchor,
  content,
  age = 1,
}: {
  lang: Lang;
  anchor: Point;
  content: IslandContent;
  age?: number;
}) {
  return <CommandIsland lang={lang} t={age} moments={[{ at: 0, content }]} anchor={anchor} />;
}

/**
 * The 0.8 page of the sheet (`t` 0 → 8 s): every island content at rest (press, working, writing,
 * written, copied, the options card's list, sheet and drill-down pages, the answer card), one live
 * island running through a hold, a pick and a write-back, the toolbar's split buttons with the
 * When-done menus, and the keycaps' open legends.
 */
export function SheetIsland({ lang, t }: { lang: Lang; t: number }) {
  const c = sheet08[lang];
  const s = strings[lang].command;
  const saved = outputChoice(lang, { saved: 'replaceSelection' });
  const picked = outputChoice(lang, { saved: 'replaceSelection', current: 'insertAfterSelection' });
  const list = { title: c.polish, values: saved.values, current: saved.current };
  const live: IslandMoment[] = [
    { at: 0.4, content: { kind: 'press', command: c.polish } },
    {
      at: 0.7,
      content: { kind: 'card', card: { ...list, selected: 1, moves: [{ at: 1.6, to: 2 }] } },
    },
    { at: 2.4, content: { kind: 'working', command: c.polish } },
    { at: 3.6, content: { kind: 'writing' } },
    { at: 4.6, content: { kind: 'done' } },
  ];
  const menuItems: MenuItem[] = [
    {
      title: c.languageLabel,
      detail: c.languages[c.language] ?? '',
      reserved: c.languages,
      submenu: true,
    },
    outputMenuRow(picked),
    'separator',
    { title: s.run, detail: c.languages[c.language] ?? '' },
  ];
  const menuOrigin = { x: 1500, y: 340 };
  const whenDone = menuItemRects(menuOrigin, menuItems)[1] ?? { x: 0, y: 0, width: 0, height: 0 };
  const submenu = outputMenuItems(picked);
  const submenuWidth = menuFrame({ x: 0, y: 0 }, submenu).width;
  return (
    <div className="pk-sheet__layer">
      <Still
        lang={lang}
        anchor={{ x: 280, y: 80 }}
        content={{ kind: 'press', command: c.polish }}
        age={0.16}
      />
      <Still
        lang={lang}
        anchor={{ x: 280, y: 130 }}
        content={{ kind: 'working', command: c.translate, summary: c.languages[c.language] ?? '' }}
      />
      <Still lang={lang} anchor={{ x: 280, y: 180 }} content={{ kind: 'writing' }} />
      <Still lang={lang} anchor={{ x: 280, y: 230 }} content={{ kind: 'done' }} />
      <Still lang={lang} anchor={{ x: 280, y: 280 }} content={{ kind: 'copied' }} />
      <CommandIsland
        lang={lang}
        t={t % 6.4}
        moments={live}
        exit={6.1}
        anchor={{ x: 280, y: 1040 }}
      />
      <Still
        lang={lang}
        anchor={{ x: 780, y: 256 }}
        content={{ kind: 'card', card: { ...list, selected: 2 } }}
      />
      <Still
        lang={lang}
        anchor={{ x: 780, y: 408 }}
        content={{
          kind: 'card',
          card: {
            title: c.translate,
            page: 'sheet',
            values: [c.languageLabel, saved.label],
            details: [c.languages[c.language] ?? '', saved.values[saved.current] ?? ''],
            current: -1,
            selected: 1,
          },
        }}
      />
      <Still
        lang={lang}
        anchor={{ x: 780, y: 644 }}
        content={{
          kind: 'card',
          card: {
            title: saved.label,
            page: 'drill',
            values: saved.values,
            current: 2,
            selected: 2,
          },
        }}
      />
      <Still
        lang={lang}
        anchor={{ x: 780, y: 1012 }}
        content={{
          kind: 'card',
          card: {
            title: c.translate,
            values: c.languages,
            current: c.language,
            selected: c.language,
          },
        }}
      />
      <Still
        lang={lang}
        anchor={{ x: 1250, y: 156 }}
        content={{
          kind: 'answer',
          card: {
            command: c.polish,
            answer: c.answer,
            note: fill(s.unwritten.noSelection, { app: c.app }),
          },
        }}
      />
      <Still
        lang={lang}
        anchor={{ x: 1250, y: 1010 }}
        content={{ kind: 'answer', card: { command: c.summarize, answer: c.longAnswer } }}
      />
      <div className="pk-sheet__at" data-at="split">
        <SelectionCapsule
          lang={lang}
          commands={[c.translate, c.polish]}
          options="all"
          more={false}
          chevron="open"
          chevronAt={1}
        />
      </div>
      <OptionsMenu origin={{ x: 1500, y: 80 }} items={outputMenuItems(saved)} hover={2} />
      <div className="pk-sheet__at" data-at="split-more">
        <SelectionCapsule lang={lang} commands={[c.translate]} options="all" chevron="open" />
      </div>
      <OptionsMenu origin={menuOrigin} items={menuItems} active={1} />
      <OptionsMenu
        origin={{ x: menuOrigin.x - MENU.offset - submenuWidth, y: whenDone.y - MENU.padding }}
        items={submenu}
        hover={2}
      />
      <div className="pk-sheet__at" data-at="keys-hint">
        <Keycaps
          t={t}
          variant="hint"
          size={30}
          keys={[
            { legend: '⌘' },
            { legend: '⇧' },
            { legend: 'T' },
            { legend: 'Esc' },
            { legend: '↩' },
            { legend: '1' },
            { legend: '9' },
            { legend: 'Tab' },
          ]}
        />
      </div>
      <div className="pk-sheet__at" data-at="keys-macro">
        <Keycaps
          t={t}
          size={64}
          keys={[
            { legend: '⌃' },
            { legend: '⌥', press: 1, release: 2.2 },
            { legend: 'Esc' },
            { legend: '3', press: 2.6 },
            { legend: 'Space' },
            { legend: '↩', press: 3.2 },
          ]}
        />
      </div>
    </div>
  );
}
