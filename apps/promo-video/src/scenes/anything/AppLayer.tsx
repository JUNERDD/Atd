import type { Lang } from '../../copy.ts';
import { AppWindowContent } from '../../kit/product/AppWindowContent.tsx';
import type { HabitCheck } from '../../kit/product/habits.ts';
import { PinnedWidget } from '../../kit/product/PinnedWidget.tsx';
import type { CursorState } from '../../kit/world/cursor.ts';
import { MacWindow } from '../../kit/world/MacWindow.tsx';
import { clamp01, mix, ramp } from '../../motion/ease.ts';
import { springAt, type Spring } from '../../motion/spring.ts';
import { Move } from '../../ui/Move.tsx';
import { APP, CARD, PIN, WINDOW } from './beats.ts';
import { content } from './content.ts';

/** Today is Thursday; the days before it already carry a few checks. */
const TODAY = 3;
const EARLIER: HabitCheck[] = [
  { habit: 0, day: 0 },
  { habit: 0, day: 1 },
  { habit: 0, day: 2 },
  { habit: 1, day: 0 },
  { habit: 1, day: 2 },
  { habit: 2, day: 1 },
  { habit: 2, day: 2 },
];
/** Today's checks fill on the beat, one habit after another. */
const CHECKS: HabitCheck[] = [
  ...EARLIER,
  ...APP.use.map((at, habit) => ({ habit, day: TODAY, at })),
];

/**
 * The window travels out of the card and settles before the first check is clicked; its size
 * springs with a little more life than a plain window spring.
 */
const TRAVEL: Spring = { response: 0.5, damping: 0.92 };
const GROW: Spring = { response: 0.55, damping: 0.7 };

/**
 * The habit tracker on the desktop: its window springing out of the panel's app card when Open is
 * clicked, the card's pin following the pointer as it is dragged out, and the pin landing on the
 * wallpaper. Laid out in the Mac's points.
 */
export function AppLayer({ lang, t, cursor }: { lang: Lang; t: number; cursor: CursorState }) {
  const c = content[lang].app;
  const habits = c.habits.map((name) => ({ name }));
  if (t < APP.open) return null;
  const out = springAt(t, APP.open, TRAVEL);
  const grow = springAt(t, APP.open, GROW);
  const center = { x: WINDOW.x + WINDOW.width / 2, y: WINDOW.y + WINDOW.height / 2 };
  const dragging = t >= APP.pin && t < APP.pinned + 0.1;
  const lift = springAt(t, APP.pin, { response: 0.35, damping: 0.8 });
  return (
    <>
      <Move
        box={WINDOW}
        motion={{
          x: (CARD.x - center.x) * (1 - out),
          y: (CARD.y - center.y) * (1 - out),
          scale: mix(0.16, 1, grow),
          opacity: clamp01(grow * 2.5),
          blur: Math.max(0, (1 - grow) * 10),
        }}
      >
        <MacWindow
          box={{ x: 0, y: 0, width: WINDOW.width, height: WINDOW.height }}
          material="glass"
        >
          <AppWindowContent
            lang={lang}
            title={c.name}
            subtitle={c.subtitle}
            habits={habits}
            checks={CHECKS}
            time={t}
            today={TODAY}
            material="glass"
          />
        </MacWindow>
      </Move>
      {t >= APP.pinned && (
        <div className="anything-at" style={{ '--x': PIN.x, '--y': PIN.y }}>
          <PinnedWidget
            lang={lang}
            title={c.name}
            habits={habits}
            checks={CHECKS}
            time={t}
            today={TODAY}
            land={t - APP.pinned}
          />
        </div>
      )}
      {dragging && (
        <div
          className="anything-drag"
          style={{
            '--x': cursor.x,
            '--y': cursor.y,
            '--s': mix(0.5, 0.9, lift),
            '--o': clamp01(lift * 3) * (1 - ramp(t, APP.pinned, 0.1)),
          }}
        >
          <PinnedWidget
            lang={lang}
            title={c.name}
            habits={habits}
            checks={CHECKS}
            time={t}
            today={TODAY}
          />
        </div>
      )}
    </>
  );
}
