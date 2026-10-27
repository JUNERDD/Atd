import { ChevronRight, Info } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@atd/ui/components/collapsible';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@atd/ui/components/popover';
import { Separator } from '@atd/ui/components/separator';
import { cn } from '@atd/ui/lib/utils';
import { IconButton } from '../../../components/icon-button';
import type { TurnUsage } from './turn-usage';

/** Below a dollar, a fixed four decimals keep cheap amounts visible and their digits aligned. */
function formatCost(cost: number, locale: string | undefined): string {
  const digits = cost < 1 ? 4 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cost);
}

function tokens(usage: TurnUsage): number {
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function sum(groups: readonly TurnUsage[]): TurnUsage {
  const total: TurnUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const group of groups) {
    total.input += group.input;
    total.output += group.output;
    total.cacheRead += group.cacheRead;
    total.cacheWrite += group.cacheWrite;
    total.cost += group.cost;
  }
  return total;
}

interface Source {
  name: string;
  usage: TurnUsage;
}

/**
 * The settled turn header's usage detail: a small trigger that opens what the turn cost. The total
 * leads (its cost, or its tokens when the model's catalog has no price), then one line per
 * request that served the turn: the reply, and the request for its suggested next steps
 * (`nextStepsUsage`) when there was one. Cache counts stay folded under a disclosure, and only
 * when some request reported any.
 */
export function TurnUsageDetail({
  usage,
  nextStepsUsage,
}: {
  usage: TurnUsage | null;
  nextStepsUsage?: TurnUsage | undefined;
}) {
  const { t, i18n } = useTranslation('tasks');
  const locale = i18n.resolvedLanguage;
  const count = new Intl.NumberFormat(locale);
  const [cacheOpen, setCacheOpen] = useState(false);
  const sources: Source[] = [];
  if (usage) sources.push({ name: t('transcript.usage.reply'), usage });
  if (nextStepsUsage)
    sources.push({ name: t('transcript.usage.nextSteps'), usage: nextStepsUsage });
  const total = sum(sources.map((source) => source.usage));
  const priced = total.cost > 0;
  const allTokens = t('transcript.usage.tokens', { formatted: count.format(tokens(total)) });
  const split = (group: TurnUsage) =>
    t('transcript.usage.split', {
      input: count.format(group.input),
      output: count.format(group.output),
    });
  const cached = sources.filter(({ usage: group }) => group.cacheRead + group.cacheWrite > 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          label={t('transcript.usage.label')}
          size="icon-xs"
          className="-my-1"
          tooltip={false}
        >
          <Info />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="gap-3">
        <div className="flex flex-col">
          <PopoverTitle className="text-xs font-normal text-muted-foreground">
            {t('transcript.usage.title')}
          </PopoverTitle>
          <p className="m-0 text-2xl font-semibold tabular-nums">
            {priced ? formatCost(total.cost, locale) : allTokens}
          </p>
          <p className="m-0 text-xs text-muted-foreground tabular-nums">
            {/* With the breakdown below, the total; alone, its split, so input and output stay visible. */}
            {priced && sources.length > 1 ? allTokens : split(total)}
          </p>
        </div>
        {/* One request needs no breakdown: the summary above already is its figures. */}
        {sources.length > 1 && (
          <>
            <Separator />
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {sources.map((source) => (
                <li key={source.name} className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm">{source.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {split(source.usage)}
                    </span>
                  </div>
                  {priced && (
                    <span className="text-sm tabular-nums">
                      {formatCost(source.usage.cost, locale)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {cached.length > 0 && (
          <Collapsible open={cacheOpen} onOpenChange={setCacheOpen}>
            <CollapsibleTrigger asChild>
              {/* Pulled left by its 8px start padding plus the 4.5px the glyph sits inside its box,
                  so the chevron's stroke lines up with the text above while the hover fill still
                  surrounds it. */}
              <Button variant="ghost" size="xs" className="-ml-3 text-muted-foreground">
                <ChevronRight data-icon="inline-start" className={cn(cacheOpen && 'rotate-90')} />
                {t('transcript.usage.cacheDetails')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="m-0 mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {cached.map((source) => (
                  <div key={source.name} className="contents">
                    <dt className="text-muted-foreground">{source.name}</dt>
                    <dd className="m-0 text-right tabular-nums">
                      {t('transcript.usage.cache', {
                        read: count.format(source.usage.cacheRead),
                        write: count.format(source.usage.cacheWrite),
                      })}
                    </dd>
                  </div>
                ))}
              </dl>
            </CollapsibleContent>
          </Collapsible>
        )}
      </PopoverContent>
    </Popover>
  );
}
