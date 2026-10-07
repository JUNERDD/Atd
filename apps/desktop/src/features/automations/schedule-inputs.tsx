import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { systemTimeZone, timeZones } from './automation-time';
import { errorId } from './use-automation-problems';

/**
 * The inputs time-based triggers combine: an interval, a time of day, a day of the month, and the
 * time zone a schedule's times and an idle trigger's days are read in.
 */

const UNITS = [
  { id: 'minutes', minutes: 1 },
  { id: 'hours', minutes: 60 },
  { id: 'days', minutes: 1440 },
] as const;
type Unit = (typeof UNITS)[number];
const MONTH_DAYS = Array.from({ length: 28 }, (_, index) => index + 1);

/** The largest unit that divides the interval, so 120 minutes reads as 2 hours. */
function unitOf(everyMinutes: number): Unit {
  return (
    UNITS.findLast((unit) => everyMinutes > 0 && everyMinutes % unit.minutes === 0) ?? UNITS[0]
  );
}

/**
 * "Every N minutes, hours or days". The number keeps what is typed (a cleared field stays empty),
 * and the unit stays as chosen; the schedule stores the total in minutes, 0 while it is not a
 * whole positive number, which the editor reports on save.
 */
export function IntervalField({
  everyMinutes,
  onChange,
  error,
}: {
  everyMinutes: number;
  onChange: (everyMinutes: number) => void;
  error: string;
}) {
  const { t } = useTranslation('automations');
  const [unit, setUnit] = useState(() => unitOf(everyMinutes));
  const [text, setText] = useState(() => String(everyMinutes / unit.minutes));
  const total = (value: string, size: number) => {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 ? count * size : 0;
  };
  return (
    <div className="settings-field">
      <Label htmlFor="automation-interval">{t('schedule.every')}</Label>
      <div className="automation-inline-fields">
        <Input
          id="automation-interval"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={text}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId('schedule') : 'automation-interval-note'}
          onChange={(event) => {
            setText(event.target.value);
            onChange(total(event.target.value, unit.minutes));
          }}
        />
        <Select
          value={unit.id}
          onValueChange={(value) => {
            const next = UNITS.find((item) => item.id === value);
            if (!next) return;
            setUnit(next);
            onChange(total(text, next.minutes));
          }}
        >
          <SelectTrigger aria-label={t('schedule.unit')} className="automation-unit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t(`schedule.units.${item.id}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <FieldError id={errorId('schedule')}>{error}</FieldError>
      ) : (
        <p id="automation-interval-note" className="settings-field-note">
          {t('schedule.intervalNote')}
        </p>
      )}
    </div>
  );
}

export function TimeField({
  time,
  onChange,
  error,
}: {
  time: string;
  onChange: (time: string) => void;
  error: string;
}) {
  const { t } = useTranslation('automations');
  return (
    <div className="settings-field">
      <Label htmlFor="automation-time">{t('schedule.time')}</Label>
      <Input
        id="automation-time"
        type="time"
        value={time}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? errorId('schedule') : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** A monthly schedule's day: 1 to 28 (every month has them) or the last day. */
export function MonthDaySelect({
  day,
  onChange,
}: {
  day: number | 'last';
  onChange: (day: number | 'last') => void;
}) {
  const { t } = useTranslation('automations');
  return (
    <Select
      value={String(day)}
      onValueChange={(value) => onChange(value === 'last' ? 'last' : Number(value))}
    >
      <SelectTrigger
        id="automation-month-day"
        className="w-full"
        aria-describedby="automation-month-day-note"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MONTH_DAYS.map((item) => (
          <SelectItem key={item} value={String(item)}>
            {t('schedule.dayOf', { day: item })}
          </SelectItem>
        ))}
        <SelectItem value="last">{t('schedule.lastDay')}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * The trigger's time zone, with the Mac's own marked. A schedule's and an idle trigger's zone
 * share the field and its problem (`timezone`).
 */
export function TimeZoneSelect({
  timezone,
  onChange,
  error,
}: {
  timezone: string;
  onChange: (timezone: string) => void;
  error: string;
}) {
  const { t } = useTranslation('automations');
  const system = systemTimeZone();
  return (
    <div className="settings-field">
      <Label htmlFor="automation-timezone">{t('schedule.timeZone')}</Label>
      <div className="flex flex-col gap-2">
        <Select value={timezone} onValueChange={onChange}>
          <SelectTrigger
            id="automation-timezone"
            className="w-full"
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId('timezone') : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeZones(timezone).map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone === system
                  ? t('schedule.systemZone', { zone: zone.replaceAll('_', ' ') })
                  : zone.replaceAll('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <FieldError id={errorId('timezone')}>{error}</FieldError>}
      </div>
    </div>
  );
}
