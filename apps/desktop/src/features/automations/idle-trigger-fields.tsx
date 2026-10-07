import { useTranslation } from 'react-i18next';
import {
  AUTOMATION_IDLE_MAX_MINUTES,
  AUTOMATION_IDLE_MIN_MINUTES,
  type AutomationTrigger,
} from '@atd/agent-contracts';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { minutesWords } from './automation-words';
import { TimeZoneSelect } from './schedule-inputs';
import type { AutomationProblemsView } from './use-automation-problems';

type IdleTrigger = Extract<AutomationTrigger, { kind: 'idle' }>;

/** Idle-time choices in minutes, within the contract's bounds; a value saved outside them stays listed. */
const IDLE_MINUTES = [5, 10, 15, 30, 45, 60, 90, 120].filter(
  (minutes) => minutes >= AUTOMATION_IDLE_MIN_MINUTES && minutes <= AUTOMATION_IDLE_MAX_MINUTES,
);

/**
 * An idle trigger's fields: how long the Mac must have had no input, and the time zone whose
 * calendar day bounds its once-a-day run (a new one starts in the Mac's). The service cannot say
 * in advance when the Mac will be idle, so a note explains when it runs instead of next run times.
 */
export function IdleTriggerFields({
  trigger,
  onChange,
  problems,
}: {
  trigger: IdleTrigger;
  onChange: (trigger: IdleTrigger) => void;
  problems: AutomationProblemsView;
}) {
  const { t } = useTranslation('automations');
  const choices = [...new Set([...IDLE_MINUTES, trigger.idleMinutes])].sort((a, b) => a - b);
  return (
    <div className="automation-field-stack">
      <div className="field-columns aligned-fields">
        <div className="settings-field">
          <Label htmlFor="automation-idle">{t('idle.after')}</Label>
          <Select
            value={String(trigger.idleMinutes)}
            onValueChange={(value) => onChange({ ...trigger, idleMinutes: Number(value) })}
          >
            <SelectTrigger
              id="automation-idle"
              className="w-full"
              aria-describedby="automation-idle-note"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutesWords(minutes, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TimeZoneSelect
          timezone={trigger.timezone}
          onChange={(timezone) => onChange({ ...trigger, timezone })}
          error={problems.text('timezone')}
        />
      </div>
      <p id="automation-idle-note" className="settings-field-note">
        {t('idle.note')}
      </p>
    </div>
  );
}
