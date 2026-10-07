import { useCopy } from '../../i18n/lang';
import { Section } from '../../ui/section';
import { automationsCopy } from './copy';
import { Schedule } from './schedule';

/** Automations: example schedules lit on the week, as an LED matrix, with the rule each one states. */
export function AutomationsSection() {
  const t = useCopy(automationsCopy);

  return (
    <Section id="automations" title={t.title} lede={t.lede}>
      <Schedule
        legend={t.presetsLegend}
        presets={t.presets}
        ruleKinds={t.ruleKinds}
        days={t.days}
      />
    </Section>
  );
}
