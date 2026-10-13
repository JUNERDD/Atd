import { mix, ramp } from '../../../motion/ease.ts';
import { springAt, springs } from '../../../motion/spring.ts';
import { AnnotationToolbar } from '../../../kit/product/AnnotationToolbar.tsx';
import { CommandIsland } from '../../../kit/product/CommandIsland.tsx';
import { ElementBox } from '../../../kit/product/ElementBox.tsx';
import { MiniPanelPill } from '../../../kit/product/MiniPanelPill.tsx';
import { SpotlightOverlay } from '../../../kit/product/SpotlightOverlay.tsx';
import { StepBadge } from '../../../kit/product/StepBadge.tsx';
import { PdfIcon } from '../../../kit/world/PdfIcon.tsx';
import { StatusItem, type StatusState } from '../../../kit/world/StatusItem.tsx';
import { content } from './content.ts';
import { Fit, type VignetteProps } from './Fit.tsx';
import './vignettes.css';

/** A frozen page to capture: a heading, two cards and body lines, in the tile's content px. */
function MockPage() {
  return (
    <div className="r08-every-v__page" aria-hidden="true">
      <i data-part="bar" />
      <i data-part="title" />
      <i data-part="card-a" />
      <i data-part="card-b" />
      <i data-part="line-a" />
      <i data-part="line-b" />
    </div>
  );
}

/** The page's elements as the pointer finds them (`MockPage` geometry), then the whole content. */
const TARGETS = [
  { box: { x: 40, y: 50, width: 300, height: 36 }, at: 0 },
  { box: { x: 40, y: 104, width: 292, height: 120 }, at: 0.22 },
  { box: { x: 352, y: 104, width: 292, height: 120 }, at: 0.42 },
  { box: { x: 24, y: 36, width: 636, height: 252 }, at: 0.62 },
];

/**
 * Screen capture: the display dims and the box snaps from element to element, the selection
 * commits with its handles, then Spotlight and Step Number marks go on as the bars pop in.
 */
export function CaptureVignette({ lang, age }: VignetteProps) {
  const marking = age >= 0.8;
  return (
    <Fit width={684} height={324}>
      <MockPage />
      {marking ? (
        <>
          <SpotlightOverlay
            rect={{ x: 40, y: 104, width: 292, height: 120 }}
            progress={ramp(age, 0.8, 0.25)}
          />
          <StepBadge number={1} x={56} y={120} age={age - 0.95} />
          <StepBadge number={2} x={368} y={120} age={age - 1.25} />
        </>
      ) : (
        <ElementBox targets={TARGETS} time={age} dim={ramp(age, 0, 0.15)} handles={age > 0.7} />
      )}
      <div className="r08-every-v__annotate">
        <AnnotationToolbar
          lang={lang}
          tool={age < 1.1 ? 'spotlight' : 'step'}
          canUndo={age > 0.95}
          styleBar={false}
          entrance={age - 0.75}
        />
      </div>
    </Fit>
  );
}

/** Step numbers landing on a frozen page under a spotlight, an eighth apart. */
export function StepsVignette({ age }: VignetteProps) {
  return (
    <Fit width={324} height={324}>
      <div className="r08-every-v__page" data-small="" aria-hidden="true">
        <i data-part="card-a" />
        <i data-part="card-b" />
        <i data-part="line-a" />
      </div>
      <SpotlightOverlay
        rect={{ x: 30, y: 36, width: 264, height: 120 }}
        progress={ramp(age, 0, 0.25)}
      />
      <StepBadge number={1} x={58} y={70} diameter={40} age={age - 0.1} />
      <StepBadge number={2} x={160} y={200} diameter={40} age={age - 0.4} />
      <StepBadge number={3} x={262} y={260} diameter={40} age={age - 0.7} />
    </Fit>
  );
}

/**
 * The Mini Panel as a drop target: a file dragged toward the screen edge turns the pill into the
 * invite capsule, then the drop card; the drop squashes it and it folds back into the pill.
 */
export function MiniVignette({ lang, age: since }: VignetteProps) {
  // The drop replays every 1.8 s, so the tile stays alive whenever the camera passes it.
  const age = since % 1.8;
  const toward =
    springAt(age, 0.05, springs.window) * 0.5 + springAt(age, 0.4, springs.window) * 0.5;
  const swell = toward * (1 - springAt(age, 0.95, springs.window));
  const drag = ramp(age, 0.05, 0.5);
  const dropped = age >= 0.62;
  return (
    <Fit width={324} height={684}>
      <div className="r08-every-v__edge">
        <MiniPanelPill
          lang={lang}
          swell={swell}
          stretch={{ x: -1, y: 0.4, amount: drag * (1 - ramp(age, 0.45, 0.2)) }}
          absorb={age - 0.62}
        />
      </div>
      {dropped ? null : (
        <div
          className="r08-every-v__drag"
          style={{ '--ev-dx': mix(40, 168, drag), '--ev-dy': mix(470, 316, drag) }}
        >
          <PdfIcon name={content[lang].dragged} size={88} ghost={drag > 0.05} />
        </div>
      )}
    </Fit>
  );
}

/** Atd in the menu bar: idle, running with its dot, then asking for attention, on the beat. */
export function StatusVignette({ age }: VignetteProps) {
  const states: StatusState[] = ['idle', 'running', 'running', 'attention'];
  const state = states[Math.floor(Math.max(0, age) / 0.6) % states.length] ?? 'idle';
  return (
    <div className="r08-every-v__menubar">
      <span className="r08-every-v__status">
        <StatusItem state={state} badge={springAt(age % 0.6, 0, springs.pop)} />
      </span>
    </div>
  );
}

/** A command run from the selection: the island working, writing, then Written. */
export function IslandVignette({ lang, age }: VignetteProps) {
  const command = content[lang].command;
  return (
    <Fit width={216} height={216} scale={1.5}>
      <CommandIsland
        lang={lang}
        t={age}
        anchor={{ x: 108, y: 150 }}
        moments={[
          { at: 0, content: { kind: 'working', command } },
          { at: 0.45, content: { kind: 'writing' } },
          { at: 0.8, content: { kind: 'done' } },
        ]}
      />
    </Fit>
  );
}
