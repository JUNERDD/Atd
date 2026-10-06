import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { automationsCopy } from './copy';
import { Schedule } from './schedule';
import './automations.css';

/**
 * Automations, which ship in 0.7: the heading carries the release badge, the schedule panel shows
 * example triggers on a week grid, and the list states how unattended runs behave.
 */
export function AutomationsSection() {
  const t = useCopy(automationsCopy);

  const title = (
    <>
      <span className="auto__badge">{t.badge}</span>
      <span className="sr-only">{t.badgeJoin}</span>
      {t.title}
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
        <div className="auto__promises">
          <h3 className="auto__subtitle">{t.promisesTitle}</h3>
          <ol className="auto__list">
            {t.promises.map((promise, index) => (
              <li className="auto__item reveal" key={promise.title}>
                <span className="auto__code mono-label">{`C·${String(index + 1).padStart(2, '0')}`}</span>
                <p className="auto__item-title">{promise.title}</p>
                <p className="auto__item-body">{promise.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}
