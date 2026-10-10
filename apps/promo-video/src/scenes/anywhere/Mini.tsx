import type { Lang } from '../../copy.ts';
import { clamp01, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { MiniPanelPill } from '../../kit/product/MiniPanelPill.tsx';
import type { CursorState } from '../../kit/world/cursor.ts';
import { FinderWindow } from '../../kit/world/FinderWindow.tsx';
import { PdfIcon } from '../../kit/world/PdfIcon.tsx';
import type { AnywhereContent } from './content.ts';
import { FINDER, MINI, MINI_CARD, MINI_MIDDLE } from './layout.ts';
import { A } from './plan.ts';

const M = A.mini;
/** Finder and the mini panel arrive under the whip that brings the camera to them. */
export const MINI_IN = M.start - 0.02;

/** The PDF is held from a moment after the press until the card takes it in. */
function dragging(t: number): boolean {
  return t > M.pickup + 0.06 && t < M.drop + 0.22;
}

/**
 * Finder with the PDF, and the mini panel on the screen's right edge: the pill reaches for the
 * dragged file, swells into the "Drop to add as context" card, takes the drop with a squash and
 * settles back to the pill.
 */
export function MiniDesk({
  lang,
  c,
  t,
  cursor,
}: {
  lang: Lang;
  c: AnywhereContent;
  t: number;
  cursor: CursorState;
}) {
  if (t < MINI_IN) return null;
  const swell =
    (springAt(t, M.magnet - 0.3, springs.window) * 0.5 +
      springAt(t, M.magnet, springs.window) * 0.5) *
    (1 - springAt(t, M.settle, springs.window));
  const reach = ramp(t, M.pickup + 0.15, 0.45) * (1 - ramp(t, M.drop - 0.12, 0.2));
  const arrive = springAt(t, MINI_IN, springs.window);
  return (
    <>
      <div
        className="aw-window-in"
        style={{
          '--o': clamp01(arrive * 1.6),
          '--s': 0.95 + 0.05 * arrive,
          '--ox': FINDER.x + FINDER.width / 2,
          '--oy': FINDER.y + FINDER.height / 2,
        }}
      >
        <FinderWindow
          lang={lang}
          box={FINDER}
          title={c.finder.title}
          items={c.finder.items}
          selected={t > M.pickup - 0.05 ? 0 : undefined}
          lifted={dragging(t) ? 0 : undefined}
        />
      </div>
      <div
        className="aw-mini"
        style={{ '--x': MINI.x, '--y': MINI.y, '--o': ramp(t, MINI_IN, 0.25) }}
      >
        <MiniPanelPill
          lang={lang}
          swell={swell}
          stretch={{
            x: cursor.x - (MINI.x + MINI.width),
            y: cursor.y - MINI_MIDDLE,
            amount: reach,
          }}
          absorb={t - M.drop}
        />
      </div>
    </>
  );
}

/** The PDF following the pointer, then taken into the card: it shrinks into its middle and fades. */
export function DragGhost({ t, cursor }: { t: number; cursor: CursorState }) {
  if (!dragging(t)) return null;
  const taken = ramp(t, M.drop, 0.2);
  const lift = springAt(t, M.pickup, springs.pop);
  return (
    <div
      className="aw-ghost"
      style={{
        '--x': mix(cursor.x, MINI_CARD.x, taken),
        '--y': mix(cursor.y, MINI_CARD.y, taken),
        '--o': clamp01(lift * 2) * (1 - taken),
        '--s': (0.9 + 0.1 * lift) * (1 - 0.6 * taken),
      }}
    >
      <PdfIcon name="" bare />
    </div>
  );
}
