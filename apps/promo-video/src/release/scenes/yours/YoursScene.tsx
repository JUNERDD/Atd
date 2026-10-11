import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Lang } from '../../../copy.ts';
import { useFontsReady } from '../../../fonts.ts';
import { COMMAND_ROW_PITCH } from '../../../kit/product/settings/CommandRow.tsx';
import { ramp } from '../../../motion/ease.ts';
import { BAR } from '../../timeline.ts';
import { CaretWipe } from '../../world/CaretWipe.tsx';
import { DotField } from '../../world/DotField.tsx';
import type { Pulse } from '../../world/dots.ts';
import { DRAG_ROWS, VIGNETTE_START, YOURS_BEATS as B } from './beats.ts';
import type { Vignette } from './content.ts';
import { effortCamera, lightCamera, orderCamera, planCamera } from './cameras.ts';
import { EffortShot } from './EffortShot.tsx';
import { EFFORT_TRIGGER, FOCUS, frameOf, LIGHT_SEND, ORDER_GRIP, PLAN_BUTTON } from './layout.ts';
import { LightShot } from './LightShot.tsx';
import { OrderShot } from './OrderShot.tsx';
import { PlanShot } from './PlanShot.tsx';
import { Words } from './Words.tsx';
import './yours.css';

const VIGNETTES: readonly Vignette[] = ['plan', 'effort', 'light', 'order'];
/** Each cut fades the new shot up over six frames, under the camera's settle. */
const CUT_FADE = 0.1;
const SHOTS = { plan: PlanShot, effort: EffortShot, light: LightShot, order: OrderShot } as const;

/** Rings through the dot field: a white one from the focus at each cut and payoff, coral ones
 * from each press, so every event on the product ripples out under the statement column. */
function pulses(lang: Lang): Pulse[] {
  const out: Pulse[] = [];
  for (const vignette of VIGNETTES) {
    out.push({ ...FOCUS, at: VIGNETTE_START[vignette], strength: 0.5, speed: 1000 });
    out.push({ ...FOCUS, at: B[vignette].words.payoff, strength: 0.75, speed: 1200 });
  }
  const trigger = { x: EFFORT_TRIGGER.x + 30, y: EFFORT_TRIGGER.y + 16 };
  const dropped = { x: ORDER_GRIP.x, y: ORDER_GRIP.y - DRAG_ROWS * COMMAND_ROW_PITCH };
  const presses: [number, { x: number; y: number }][] = [
    [B.plan.press, frameOf(PLAN_BUTTON, planCamera(B.plan.press))],
    [B.effort.open, frameOf(trigger, effortCamera(B.effort.open, lang))],
    [B.light.send, frameOf(LIGHT_SEND, lightCamera(B.light.send))],
    [B.order.press, frameOf(ORDER_GRIP, orderCamera(B.order.press))],
    [B.order.drop, frameOf(dropped, orderCamera(B.order.drop))],
  ];
  for (const [at, origin] of presses) {
    out.push({ ...origin, at, strength: 0.42, speed: 700, tint: 'coral' });
  }
  return out;
}

/**
 * The lighter breakdown: four one-bar vignettes on the dot field, each a macro shot of a real
 * surface right of a two-line statement. Bar 13: Continue with ChatGPT → "You're using your
 * ChatGPT plan". Bar 14: the command editor's Effort select, stepped down to High. Bar 15: a light
 * run whose answer lands a sixteenth after it is sent. Bar 16: a command long-pressed, lifted and
 * dragged up two places, the rows making way; on its last beat the caret wipes to the bare field.
 * Frame 0 is the bare field (the boundary with `choose`).
 */
export function YoursScene({ lang }: { lang: Lang }) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (frame === 0) {
    return (
      <AbsoluteFill className="scene r08">
        <DotField t={0} />
      </AbsoluteFill>
    );
  }
  const index = Math.min(VIGNETTES.length - 1, Math.floor(t / BAR));
  const vignette = VIGNETTES[index] ?? 'plan';
  const Shot = SHOTS[vignette];
  const start = VIGNETTE_START[vignette];
  const picture = (
    <AbsoluteFill>
      <DotField t={t} pulses={pulses(lang)} />
      <Shot t={t} lang={lang} opacity={ramp(t, start, CUT_FADE, (x) => x)} />
      <Words t={t} lang={lang} vignette={vignette} beats={B[vignette].words} />
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill className="scene r08">
      <CaretWipe
        t={t}
        at={B.wipe}
        duration={B.wipeLength}
        outgoing={picture}
        incoming={<DotField t={0} />}
      />
    </AbsoluteFill>
  );
}
