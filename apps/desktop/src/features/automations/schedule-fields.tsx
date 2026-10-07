import { useTranslation } from 'react-i18next';
import type { AutomationSchedule, AutomationTrigger } from '@atd/agent-contracts';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { FieldError } from '../commands/field-error';
import { defaultSchedule, type ScheduleKind } from './automation-draft';
import { zonedIso, zonedLocal } from './automation-time';
import { errorId, type AutomationProblemsView } from './use-automation-problems';
import { IntervalField, MonthDaySelect, TimeField, TimeZoneSelect } from './schedule-inputs';
import { WeekdayPicker } from './weekday-picker';

type ScheduleTrigger = Extract<AutomationTrigger, { kind: 'schedule' }>;

const SCHEDULE_KINDS: readonly ScheduleKind[] = [
  'once',
  'interval',
  'daily',
  'weekly',
  'monthly',
  'cron',
];

/** The fields of one repeat choice; the schedule's problem shows under them. */
function ScheduleDetail({
  schedule,
  timezone,
  onChange,
  error,
}: {
  schedule: AutomationSchedule;
  timezone: string;
  onChange: (schedule: AutomationSchedule) => void;
  error: string;
}) {
  const { t } = useTranslation('automations');
  const problem = error && <FieldError id={errorId('schedule')}>{error}</FieldError>;
  switch (schedule.kind) {
    case 'once':
      return (
        <div className="settings-field">
          <Label htmlFor="automation-at">{t('schedule.at')}</Label>
          <Input
            id="automation-at"
            type="datetime-local"
            value={zonedLocal(schedule.at, timezone)}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId('schedule') : undefined}
            onChange={(event) =>
              onChange({ ...schedule, at: zonedIso(event.target.value, timezone) ?? '' })
            }
          />
          {problem}
        </div>
      );
    case 'interval':
      return (
        <IntervalField
          everyMinutes={schedule.everyMinutes}
          onChange={(everyMinutes) => onChange({ ...schedule, everyMinutes })}
          error={error}
        />
      );
    case 'daily':
      return (
        <div className="settings-field">
          {/* One column of the two the weekly and monthly fields use, so the time keeps its width. */}
          <div className="field-columns automation-single-column">
            <TimeField
              time={schedule.time}
              onChange={(time) => onChange({ ...schedule, time })}
              error={error}
            />
          </div>
          {problem}
        </div>
      );
    case 'weekly':
      return (
        <div className="settings-field">
          <div className="field-columns aligned-fields">
            <div className="settings-field">
              <Label htmlFor="automation-days">{t('schedule.days')}</Label>
              <WeekdayPicker
                id="automation-days"
                days={schedule.days}
                invalid={Boolean(error) && !schedule.days.length}
                onChange={(days) => onChange({ ...schedule, days })}
              />
            </div>
            <TimeField
              time={schedule.time}
              onChange={(time) => onChange({ ...schedule, time })}
              error={error}
            />
          </div>
          {problem}
        </div>
      );
    case 'monthly':
      return (
        <div className="settings-field">
          <div className="field-columns aligned-fields">
            <div className="settings-field">
              <Label htmlFor="automation-month-day">{t('schedule.day')}</Label>
              <MonthDaySelect
                day={schedule.day}
                onChange={(day) => onChange({ ...schedule, day })}
              />
            </div>
            <TimeField
              time={schedule.time}
              onChange={(time) => onChange({ ...schedule, time })}
              error={error}
            />
          </div>
          <p id="automation-month-day-note" className="settings-field-note">
            {t('schedule.dayNote')}
          </p>
          {problem}
        </div>
      );
    case 'cron':
      return (
        <div className="settings-field">
          <Label htmlFor="automation-cron">{t('schedule.expression')}</Label>
          <Input
            id="automation-cron"
            value={schedule.expression}
            maxLength={120}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="0 9 * * 1-5"
            className="font-mono"
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId('schedule') : 'automation-cron-note'}
            onChange={(event) => onChange({ ...schedule, expression: event.target.value })}
          />
          {problem || (
            <p id="automation-cron-note" className="settings-field-note">
              {t('schedule.expressionNote')}
            </p>
          )}
        </div>
      );
  }
}

/**
 * A schedule's fields: how it repeats, its time zone (a new one starts in the Mac's), and the
 * details of the repeat choice. Changing the zone keeps a one-time run's wall time.
 */
export function ScheduleFields({
  trigger,
  onChange,
  problems,
}: {
  trigger: ScheduleTrigger;
  onChange: (trigger: ScheduleTrigger) => void;
  problems: AutomationProblemsView;
}) {
  const { t } = useTranslation('automations');
  const { schedule, timezone } = trigger;
  return (
    <div className="automation-field-stack">
      <div className="field-columns aligned-fields">
        <div className="settings-field">
          <Label htmlFor="automation-repeat">{t('schedule.repeat')}</Label>
          <Select
            value={schedule.kind}
            onValueChange={(value) => {
              const kind = SCHEDULE_KINDS.find((item) => item === value);
              if (kind && kind !== schedule.kind)
                onChange({ ...trigger, schedule: defaultSchedule(kind, timezone, schedule) });
            }}
          >
            <SelectTrigger id="automation-repeat" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULE_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`schedule.kinds.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TimeZoneSelect
          timezone={timezone}
          onChange={(zone) =>
            onChange({
              ...trigger,
              timezone: zone,
              schedule:
                schedule.kind === 'once'
                  ? { ...schedule, at: zonedIso(zonedLocal(schedule.at, timezone), zone) ?? '' }
                  : schedule,
            })
          }
          error={problems.text('timezone')}
        />
      </div>
      <ScheduleDetail
        schedule={schedule}
        timezone={timezone}
        onChange={(next) => onChange({ ...trigger, schedule: next })}
        error={problems.text('schedule')}
      />
    </div>
  );
}
