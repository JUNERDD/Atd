import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@atd/ui/components/popover';
import { IconButton } from '../../../components/icon-button';
import type { TurnUsage } from './turn-usage';

/** Fractions of a cent stay visible for cheap turns; whole amounts keep two decimals. */
function formatCost(cost: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: cost < 1 ? 4 : 2,
  }).format(cost);
}

/**
 * The settled turn header's usage detail: a small trigger that opens the turn's summed token
 * counts and cost. The cost row is left out when the model's catalog has no price (0).
 */
export function TurnUsageDetail({ usage }: { usage: TurnUsage }) {
  const { t, i18n } = useTranslation('tasks');
  const locale = i18n.resolvedLanguage;
  const count = new Intl.NumberFormat(locale);
  const rows: [string, string][] = [
    [t('transcript.usage.input'), count.format(usage.input)],
    [t('transcript.usage.output'), count.format(usage.output)],
    [t('transcript.usage.cacheRead'), count.format(usage.cacheRead)],
    [t('transcript.usage.cacheWrite'), count.format(usage.cacheWrite)],
  ];
  if (usage.cost > 0) rows.push([t('transcript.usage.cost'), formatCost(usage.cost, locale)]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          label={t('transcript.usage.label')}
          size="icon-xs"
          className="-my-1"
          tooltipDismissOnClick
        >
          <Info />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="gap-2">
        <PopoverTitle>{t('transcript.usage.title')}</PopoverTitle>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1">
          {rows.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="m-0 text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
