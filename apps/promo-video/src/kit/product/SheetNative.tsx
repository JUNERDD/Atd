import type { Lang } from '../../copy.ts';
import { ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { AnnotationToolbar } from './AnnotationToolbar.tsx';
import { AppWindowContent } from './AppWindowContent.tsx';
import { ElementBox } from './ElementBox.tsx';
import type { HabitCheck } from './habits.ts';
import { MiniPanelPill } from './MiniPanelPill.tsx';
import { Notification } from './Notification.tsx';
import { PinnedWidget } from './PinnedWidget.tsx';
import { SelectionCapsule } from './SelectionCapsule.tsx';
import { sheetContent } from './sheet-content.ts';
import { SpotlightOverlay } from './SpotlightOverlay.tsx';
import { StepBadge } from './StepBadge.tsx';

/** A week already half done, and today's three checks landing on the page's beats. */
const CHECKS: HabitCheck[] = [
  { habit: 0, day: 0 },
  { habit: 0, day: 1 },
  { habit: 1, day: 0 },
  { habit: 1, day: 2 },
  { habit: 2, day: 1 },
  { habit: 2, day: 2 },
  { habit: 0, day: 3, at: 1.2 },
  { habit: 1, day: 3, at: 1.6 },
  { habit: 2, day: 3, at: 2 },
];

/** The capture's elements on the sheet's mock page, in the mock screen's points. */
const TARGETS = [
  { box: { x: 40, y: 36, width: 280, height: 40 }, at: 0 },
  { box: { x: 40, y: 96, width: 330, height: 120 }, at: 0.6 },
  { box: { x: 400, y: 96, width: 300, height: 120 }, at: 1.1 },
  { box: { x: 24, y: 84, width: 692, height: 248 }, at: 1.6 },
];

/** Page two of the sheet (`t` 0 → 4 s): the shell's native surfaces and the built app. */
export function SheetNative({ lang, t }: { lang: Lang; t: number }) {
  const c = sheetContent[lang];
  const swellIn = springAt(t, 0.5, springs.window) * 0.5 + springAt(t, 1.1, springs.window) * 0.5;
  const swell = swellIn * (1 - springAt(t, 2.3, springs.window));
  const habits = c.habits.map((name) => ({ name }));
  return (
    <>
      <div className="pk-sheet__screen">
        <div className="pk-mock">
          <i data-line="title" />
          <i data-card="a" />
          <i data-card="b" />
          <i data-line="body" />
        </div>
        {t < 2.2 ? (
          <ElementBox targets={TARGETS} time={t} dim={ramp(t, 0, 0.25)} handles={t > 1.9} />
        ) : (
          <>
            <SpotlightOverlay
              rect={{ x: 40, y: 96, width: 330, height: 120 }}
              progress={ramp(t, 2.2, 0.3)}
            />
            <StepBadge number={1} x={56} y={112} age={t - 2.6} />
            <StepBadge number={2} x={416} y={112} age={t - 2.95} />
          </>
        )}
      </div>
      <div className="pk-sheet__at" data-at="annotation">
        <AnnotationToolbar
          lang={lang}
          tool={t < 2.4 ? 'spotlight' : 'step'}
          canUndo={t > 2.4}
          entrance={t - 1.9}
          pressed={t > 3.4 && t < 3.6 ? 'done' : undefined}
          hover={t > 3.1 ? 'done' : undefined}
        />
      </div>
      <div className="pk-sheet__at" data-at="capsule">
        <SelectionCapsule
          lang={lang}
          commands={c.commands}
          entrance={t - 0.3}
          hover={t > 1.2 ? 1 : undefined}
          pressed={t > 1.7 && t < 1.9 ? 1 : undefined}
        />
      </div>
      <div className="pk-sheet__at" data-at="capsule-mark">
        <SelectionCapsule lang={lang} commands={c.commands} lead="mark" more={false} hover={0} />
      </div>
      <div className="pk-sheet__at" data-at="notice">
        <Notification lang={lang} title={c.notice.title} body={c.notice.body} enter={t - 0.4} />
      </div>
      <div className="pk-sheet__at" data-at="notice-2">
        <Notification lang={lang} title={c.created.skill} enter={t - 0.8} />
      </div>
      <div className="pk-sheet__edge">
        <MiniPanelPill
          lang={lang}
          swell={swell}
          stretch={{ x: -1, y: 0.3, amount: ramp(t, 0.2, 0.4) * (1 - ramp(t, 1, 0.3)) }}
          absorb={t - 2}
        />
      </div>
      <div className="pk-sheet__at" data-at="app">
        <AppWindowContent
          lang={lang}
          title={c.appName}
          subtitle={c.thisWeek}
          habits={habits}
          checks={CHECKS}
          time={t}
        />
      </div>
      <div className="pk-sheet__at" data-at="pin-small">
        <PinnedWidget
          lang={lang}
          title={c.appName}
          habits={habits}
          checks={CHECKS}
          time={t}
          land={t - 2.6}
        />
      </div>
      <div className="pk-sheet__at" data-at="pin-medium">
        <PinnedWidget
          lang={lang}
          title={c.appName}
          habits={habits}
          checks={CHECKS}
          time={t}
          size="medium"
          land={t - 2.9}
        />
      </div>
    </>
  );
}
