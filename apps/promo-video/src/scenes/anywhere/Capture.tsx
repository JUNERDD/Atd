import type { Lang } from '../../copy.ts';
import { clamp01, mix, ramp } from '../../motion/ease.ts';
import { springAt } from '../../motion/spring.ts';
import { AnnotationToolbar, type AnnotationTool } from '../../kit/product/AnnotationToolbar.tsx';
import type { BoxTarget } from '../../kit/product/capture.ts';
import { ElementBox } from '../../kit/product/ElementBox.tsx';
import { SpotlightOverlay } from '../../kit/product/SpotlightOverlay.tsx';
import { StepBadge } from '../../kit/product/StepBadge.tsx';
import type { CursorState } from '../../kit/world/cursor.ts';
import type { Rect } from '../../kit/world/points.ts';
import type { AnywhereContent } from './content.ts';
import { ChartCard } from './Dashboard.tsx';
import { BARS_ANCHOR, CARD, DASH_PARTS, onDisplay, PANEL, SPOTLIGHT, STEPS } from './layout.ts';
import { A, SPOT_DRAG } from './plan.ts';

const C = A.screenshot;

/** The elements the pointer finds, then the chart card the scroll grows the box to. */
const TARGETS: readonly BoxTarget[] = [
  { box: onDisplay({ ...DASH_PARTS.title, x: DASH_PARTS.title.x - 6, width: 116 }), at: C.freeze },
  { box: onDisplay(DASH_PARTS.kpi(0)), at: C.hover[0] },
  { box: onDisplay(DASH_PARTS.export), at: C.hover[1] },
  { box: { x: CARD.x + 20, y: CARD.y + 66, width: CARD.width - 40, height: 214 }, at: C.hover[2] },
  { box: CARD, at: C.grow },
];

/** Where the capture lands: the composer's first chip, in display points. */
const CHIP = { x: PANEL.x + 112, y: PANEL.y + PANEL.height - 74 };
/** The capture's flight into the composer: quick, nearly flat. */
const FLIGHT = { response: 0.34, damping: 0.92 };

/** The spotlight as drawn so far: from where the drag began to the pointer, in the card's points. */
function spotlightAt(t: number, cursor: CursorState): Rect {
  if (t >= C.spotlight + SPOT_DRAG) return SPOTLIGHT;
  const x = Math.max(SPOTLIGHT.x + 2, cursor.x - CARD.x);
  const y = Math.max(SPOTLIGHT.y + 2, cursor.y - CARD.y);
  return { x: SPOTLIGHT.x, y: SPOTLIGHT.y, width: x - SPOTLIGHT.x, height: y - SPOTLIGHT.y };
}

/** The marks the user placed: the spotlight on the peak, then steps 1 and 2. */
function Marks({ t, cursor }: { t: number; cursor: CursorState }) {
  return (
    <>
      {t >= C.spotlight ? (
        <SpotlightOverlay rect={spotlightAt(t, cursor)} progress={ramp(t, C.spotlight, 0.12)} />
      ) : null}
      {STEPS.map((step, index) => (
        <StepBadge
          key={index}
          number={index + 1}
          x={step.x}
          y={step.y}
          age={t - (C.steps[index] ?? 0)}
        />
      ))}
    </>
  );
}

/**
 * The screenshot, over the frozen display: a flash as it freezes, the element box snapping under
 * the pointer and growing to the chart card, the committed selection with its handles, the
 * annotation bars, the spotlight and steps; then Done, and the capture flies into the composer.
 */
export function Capture({
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
  if (t < C.freeze) return null;
  const leave = ramp(t, C.done + 0.04, 0.16);
  const tool: AnnotationTool | undefined =
    t < C.spotlight - 0.2 ? undefined : t < C.steps[0] - 0.15 ? 'spotlight' : 'step';
  const flight = springAt(t, C.done + 0.04, FLIGHT);
  const from = { x: CARD.x + CARD.width / 2, y: CARD.y + CARD.height / 2 };
  return (
    <>
      {leave < 1 ? (
        <div className="aw-capture" style={{ '--o': 1 - leave }}>
          <ElementBox
            targets={TARGETS}
            time={t}
            dim={ramp(t, C.freeze, 0.18)}
            handles={t >= C.select}
          />
          <div
            className="aw-at"
            style={{ '--x': CARD.x, '--y': CARD.y, '--w': CARD.width, '--h': CARD.height }}
          >
            <Marks t={t} cursor={cursor} />
          </div>
          <div className="aw-bars" style={{ '--x': BARS_ANCHOR.x, '--y': BARS_ANCHOR.y }}>
            <AnnotationToolbar
              lang={lang}
              tool={tool}
              canUndo={t > C.spotlight + SPOT_DRAG}
              entrance={t - C.toolbar}
              hover={t > C.done - 0.25 ? 'done' : undefined}
              pressed={t > C.done - 0.04 && t < C.done + 0.12 ? 'done' : undefined}
            />
          </div>
          <i className="aw-flash" style={{ '--o': 0.28 * (1 - ramp(t, C.freeze, 0.4)) }} />
        </div>
      ) : null}
      {t >= C.done + 0.04 && flight < 0.995 ? (
        <div
          className="aw-flight"
          style={{
            '--x': CARD.x,
            '--y': CARD.y,
            '--w': CARD.width,
            '--h': CARD.height,
            '--dx': mix(0, CHIP.x - from.x, flight),
            '--dy': mix(0, CHIP.y - from.y, flight) - Math.sin(Math.PI * clamp01(flight)) * 50,
            '--s': mix(1, 0.06, flight),
            '--o': 1 - ramp(flight, 0.8, 0.18, (x) => x),
          }}
        >
          <ChartCard c={c} />
          <div className="aw-flight__marks">
            <Marks t={t} cursor={cursor} />
          </div>
        </div>
      ) : null}
    </>
  );
}

/** When the capture's chip lands in the composer. */
export const CHIP_AT = C.done + 0.26;
