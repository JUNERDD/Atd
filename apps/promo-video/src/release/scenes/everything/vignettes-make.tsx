import { BookOpen, Clock } from 'lucide-react';
import { clamp01, ramp } from '../../../motion/ease.ts';
import { springAt, springs } from '../../../motion/spring.ts';
import { AppWindowContent } from '../../../kit/product/AppWindowContent.tsx';
import { BuildCard } from '../../../kit/product/BuildCard.tsx';
import { CreatedCard } from '../../../kit/product/CreatedCard.tsx';
import type { HabitCheck } from '../../../kit/product/habits.ts';
import { MemoryChip } from '../../../kit/product/MemoryChip.tsx';
import { Notification } from '../../../kit/product/Notification.tsx';
import { PinnedWidget } from '../../../kit/product/PinnedWidget.tsx';
import { Button } from '../../../kit/product/settings/controls.tsx';
import { fill } from '../../../kit/product/strings.ts';
import { UserMessage } from '../../../kit/product/UserMessage.tsx';
import { content } from './content.ts';
import { Fit, type VignetteProps } from './Fit.tsx';
import './vignettes.css';

/** The habit week: half done already, today's three checks landing after the app opens. */
function checks(from: number): HabitCheck[] {
  return [
    { habit: 0, day: 0 },
    { habit: 0, day: 1 },
    { habit: 1, day: 0 },
    { habit: 1, day: 2 },
    { habit: 2, day: 1 },
    { habit: 2, day: 2 },
    { habit: 0, day: 3, at: from },
    { habit: 1, day: 3, at: from + 0.3 },
    { habit: 2, day: 3, at: from + 0.6 },
  ];
}

/**
 * An app from one sentence: the request, the build card filling and publishing, and the built
 * habit tracker opening beside it with today's checks landing.
 */
export function AppsVignette({ lang, t, age, spec }: VignetteProps) {
  const c = content[lang].apps;
  const open = springAt(age, 0.32, springs.window);
  return (
    <Fit width={684} height={324}>
      <div className="r08-every-v__apps">
        <div className="r08-every-v__stack">
          <UserMessage text={c.sentence} age={age} />
          <BuildCard
            lang={lang}
            name={c.name}
            summary={c.summary}
            build={ramp(age, 0.03, 0.24, (x) => x)}
            built={age - 0.28}
            press={ramp(age, 0.3, 0.05) - ramp(age, 0.38, 0.12)}
            time={t}
            age={age - 0.05}
          />
        </div>
        <div className="r08-every-v__window" style={{ '--ev-open': clamp01(open) }}>
          <AppWindowContent
            lang={lang}
            title={c.name}
            subtitle={c.week}
            habits={c.habits.map((name) => ({ name }))}
            checks={checks(spec.arrive + 0.5)}
            time={t}
          />
        </div>
      </div>
    </Fit>
  );
}

/** The app pinned to the desktop: its widget settling onto the wallpaper. */
export function PinVignette({ lang, t, age, spec }: VignetteProps) {
  const c = content[lang].apps;
  return (
    <Fit width={220} height={220} scale={1.47}>
      <div className="r08-every-v__center">
        <PinnedWidget
          lang={lang}
          title={c.name}
          habits={c.habits.map((name) => ({ name }))}
          checks={checks(spec.arrive + 0.45)}
          time={t}
          land={age}
        />
      </div>
    </Fit>
  );
}

/** An automation at night: made on request, then its result posted while nobody is there. */
export function AutomationVignette({ lang, age }: VignetteProps) {
  const c = content[lang].automation;
  return (
    <Fit width={360} height={760} scale={0.9}>
      <div className="r08-every-v__sky" aria-hidden="true">
        <i className="r08-every-v__moon" />
        {[0, 1, 2, 3, 4, 5, 6].map((index) => (
          <i key={index} className="r08-every-v__star" data-star={index} />
        ))}
      </div>
      <div className="r08-every-v__notice">
        <Notification lang={lang} title={c.name} enter={age - 0.4} />
      </div>
      <div className="r08-every-v__created">
        <CreatedCard
          lang={lang}
          kind="automation"
          name={c.name}
          detail={c.schedule}
          detailIcon={Clock}
          age={age}
          confirm={age - 0.2}
        />
      </div>
    </Fit>
  );
}

/**
 * Memory that grows a skill: a preference remembered, then the learner's "New skill" suggestion
 * accepted, which lands as the created skill.
 */
export function MemoryVignette({ lang, age }: VignetteProps) {
  const c = content[lang].memory;
  const accepted = age >= 0.6;
  return (
    <Fit width={600} height={284} scale={1.14}>
      <div className="r08-every-v__memory">
        <MemoryChip lang={lang} text={c.text} age={age} />
        {accepted ? (
          <div className="r08-every-v__row-wide">
            <CreatedCard
              lang={lang}
              kind="skill"
              name={c.skill}
              detail={c.skillTitle}
              age={age - 0.6}
              confirm={age - 0.8}
            />
            <span className="r08-every-v__note">{fill(c.created, { name: c.skill })}</span>
          </div>
        ) : (
          <div className="r08-every-v__suggestion" data-in={age > 0.15 || undefined}>
            <span className="r08-every-v__suggestion-icon">
              <BookOpen className="pk-icon" />
            </span>
            <span className="r08-every-v__suggestion-text">
              <span className="r08-every-v__title">{c.skillTitle}</span>
              <span className="r08-every-v__desc">{`${c.newSkill} · ${c.skill}`}</span>
            </span>
            <Button label={c.dismiss} variant="outline" />
            <Button label={c.accept} pressed={age > 0.45} />
          </div>
        )}
      </div>
    </Fit>
  );
}
