import type { Lang } from '../../../copy.ts';
import { CommandIsland } from '../../../kit/product/CommandIsland.tsx';
import { SelectionCapsule } from '../../../kit/product/SelectionCapsule.tsx';
import { Camera } from '../../../kit/world/Camera.tsx';
import { cameraAt } from '../../../kit/world/camera.ts';
import { MAC_CHROME } from '../../../kit/world/chrome.ts';
import { cursorAt } from '../../../kit/world/cursor.ts';
import { clamp01, ramp } from '../../../motion/ease.ts';
import { springAt, springs } from '../../../motion/spring.ts';
import type { Pulse } from '../../world/dots.ts';
import { Stage } from '../../world/Stage.tsx';
import { answerTimes, WRITEBACK_BEATS as B, WRITEBACK_ISLAND as I } from './beats.ts';
import type { WritebackContent } from './content.ts';
import { ISLAND_ANCHOR, ISLAND_MIDDLE, NOTE, PARAGRAPH, roundTripShots } from './layout.ts';
import { NoteWindow } from './NoteWindow.tsx';
import { Pointer } from './Pointer.tsx';
import { overText, pointerKeys, selectionAt, toolbarPlace } from './selection.ts';

interface RoundTripProps {
  lang: Lang;
  c: WritebackContent;
  /** Section-local seconds; frame 0 is the bare Stage at rest. */
  t: number;
}

/** Light through the wallpaper's dots: the click, the island landing, the answer, Written. */
function pulses(button: { x: number; y: number }): Pulse[] {
  return [
    { ...button, at: B.click, strength: 0.75, tint: 'coral' },
    { ...ISLAND_MIDDLE, at: I.working, strength: 0.9 },
    { ...PARAGRAPH, at: B.type, strength: 0.8, tint: 'coral' },
    { ...ISLAND_MIDDLE, at: I.done, strength: 0.7 },
  ];
}

/**
 * The round trip, on the Stage through one continuous camera: the note fades up, ⌥ is held as the
 * pointer drag-selects the rough paragraph, the selection toolbar grows out of it and Polish
 * writing is clicked; the camera follows down to the command island (Running, shimmering), and as
 * it turns to Writing… races back up while the polished text types over the selection; Written
 * shows as the camera pulls back to hold both, and the island collapses.
 */
export function RoundTrip({ lang, c, t }: RoundTripProps) {
  const camera = cameraAt(t, roundTripShots(B));
  const keys = pointerKeys(lang, c);
  const pointer = cursorAt(t, keys);
  const drag = t < B.dragDown ? null : cursorAt(Math.min(t, B.dragUp), keys);
  const selection = drag ? selectionAt(drag, c.note.rough) : [];
  const place = toolbarPlace(lang, c);
  const windowIn = springAt(t, B.windowIn, springs.window);
  const capsuleOut = clamp01((t - (B.click + 0.1)) / 0.08);
  const opened = t >= B.windowIn;
  const glint = ramp(t, I.done, 0.12) * (1 - ramp(t, I.done + 0.2, 0.7));
  return (
    <Camera state={camera}>
      <Stage
        lang={lang}
        t={t}
        pulses={opened ? pulses(place.button) : []}
        {...(opened ? { appName: c.app, menus: MAC_CHROME[lang].menus.app } : {})}
      >
        {opened ? (
          <div
            className="r08-wb-window-in"
            style={{
              '--o': clamp01(windowIn * 1.5),
              '--s': 0.965 + 0.035 * windowIn,
              '--ox': NOTE.x + NOTE.width / 2,
              '--oy': NOTE.y + NOTE.height / 2,
            }}
          >
            <NoteWindow lang={lang} c={c} t={t} selection={selection} answer={answerTimes(lang)} />
          </div>
        ) : null}
        {t >= B.toolbar && capsuleOut < 1 ? (
          <div
            className="r08-wb-toolbar"
            style={{ '--x': place.anchor.x, '--y': place.anchor.y, '--o': 1 - capsuleOut }}
          >
            <SelectionCapsule
              lang={lang}
              commands={c.commands}
              options="all"
              entrance={t - B.toolbar}
              hover={t > B.hover - 0.1 ? c.clicked + 1 : undefined}
              pressed={t > B.click - 0.03 && t < B.click + 0.12 ? c.clicked + 1 : undefined}
            />
          </div>
        ) : null}
        {glint > 0 ? (
          <div
            className="r08-wb-glint"
            style={{ '--x': ISLAND_MIDDLE.x, '--y': ISLAND_MIDDLE.y, '--o': glint }}
          />
        ) : null}
        <CommandIsland
          lang={lang}
          t={t}
          anchor={ISLAND_ANCHOR}
          exit={I.out}
          moments={[
            { at: I.working, content: { kind: 'working', command: c.commands[c.clicked] ?? '' } },
            { at: I.writing, content: { kind: 'writing' } },
            { at: I.done, content: { kind: 'done' } },
          ]}
        />
        {opened ? (
          <Pointer
            state={pointer}
            t={t}
            beam={overText(t)}
            opacity={ramp(t, B.windowIn, 0.3)}
            option={{
              show: B.optionHint,
              down: B.optionDown,
              up: B.toolbar,
              gone: B.toolbar + 0.35,
            }}
          />
        ) : null}
      </Stage>
    </Camera>
  );
}
