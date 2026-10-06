import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { weekdayName, weekdayOrder } from './automation-time';
import { daysWords } from './automation-words';
import { errorId } from './use-automation-problems';

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * A weekly schedule's days: a field that names the chosen days and opens a menu of the week in
 * the language's order (from Monday in Chinese, from Sunday in US English), with Weekdays,
 * Weekends and Every day as shortcuts. Checking a day keeps the menu open for the next one.
 * Days are stored as cron counts them, 0 for Sunday.
 */
export function WeekdayPicker({
  id,
  days,
  invalid,
  onChange,
}: {
  id: string;
  days: readonly number[];
  invalid: boolean;
  onChange: (days: number[]) => void;
}) {
  const { t, i18n } = useTranslation('automations');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="ghost"
          className="automation-field-trigger"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId('schedule') : undefined}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {days.length ? daysWords(days, i18n.language) : t('schedule.daysPlaceholder')}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onChange(WEEKDAYS)}>
          {t('schedule.weekdays')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(WEEKENDS)}>
          {t('schedule.weekends')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(EVERY_DAY)}>
          {t('schedule.everyDay')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {weekdayOrder(i18n.language).map((day) => (
          <DropdownMenuCheckboxItem
            key={day}
            checked={days.includes(day)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...days, day].sort((a, b) => a - b)
                  : days.filter((item) => item !== day),
              )
            }
          >
            {weekdayName(day, i18n.language, 'long')}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
