import { useRef } from 'react';
import { useCopy } from '../../i18n/lang';
import { useInView } from '../../lib/use-in-view';
import { Section } from '../../ui/section';
import { SplitText } from '../../ui/split-text';
import { automationsCopy } from './copy';
import { Promises } from './promises';
import { Schedule } from './schedule';
import './automations.css';

/**
 * The release badge: it decodes in just before the heading's words rise, and its lit dot breathes
 * while it is on screen. Hidden from assistive tech, which reads the badge with the heading text.
 */
function ReleaseBadge({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const onScreen = useInView(ref);

  return (
    <span
      ref={ref}
      className="auto__badge"
      aria-hidden="true"
      data-reveal="decode"
      data-reveal-delay="90"
      data-live={onScreen ? '' : undefined}
    >
      {text}
    </span>
  );
}

/**
 * Automations, which ship in 0.7: the heading carries the release badge, the schedule panel shows
 * example triggers on a week grid, and the list states how unattended runs behave.
 */
export function AutomationsSection() {
  const t = useCopy(automationsCopy);

  const title = (
    <>
      <ReleaseBadge text={t.badge} />
      <span className="sr-only">{`${t.badge}${t.badgeJoin}`}</span>
      <SplitText text={t.title} delay={160} />
    </>
  );

  return (
    <Section id="automations" index="A·03" kicker={t.kicker} title={title} lede={t.lede}>
      <div className="auto__layout">
        <Schedule
          legend={t.presetsLegend}
          presets={t.presets}
          ruleKinds={t.ruleKinds}
          days={t.days}
          triggersLabel={t.triggersLabel}
          triggers={t.triggers}
        />
        <Promises title={t.promisesTitle} promises={t.promises} />
      </div>
    </Section>
  );
}
