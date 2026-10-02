import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ContextBreakdown,
  ContextBreakdownCategory,
  ContextCategoryId,
  TaskContextState,
} from '@ai/agent-contracts';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { Spinner } from '@ai/ui/components/spinner';
import { formatContextWindow, formatTokenCount } from '../../providers/context-window';
import './context-usage.css';

/** A part of the bar and of the rows: a category, the autocompact reserve, or what is left. */
type ContextPart = ContextCategoryId | 'buffer' | 'free';

/** The bar's SVG user units across; segments are placed in them, the SVG stretches to fit. */
const BAR_UNITS = 1000;

/**
 * The bar's segments in order, each clipped to what is left of the track. Shares are of the
 * window, or of what is taken (used plus reserve) while the window is unknown.
 */
function segmentsOf(breakdown: ContextBreakdown) {
  const scale =
    breakdown.contextWindow ?? Math.max(1, breakdown.usedTokens + breakdown.autocompactBuffer);
  const parts: { id: ContextPart; tokens: number }[] = [
    ...breakdown.categories,
    { id: 'buffer', tokens: breakdown.autocompactBuffer },
  ];
  const segments: { id: ContextPart; x: number; width: number }[] = [];
  let x = 0;
  for (const part of parts) {
    const width = Math.min((part.tokens / scale) * BAR_UNITS, BAR_UNITS - x);
    if (width <= 0) continue;
    segments.push({ id: part.id, x, width });
    x += width;
  }
  return segments;
}

/**
 * The usage popover's body, after Claude Code's `/context`: the window's fill as a header and a
 * stacked bar, then one row per non-empty category (messages always), the autocompact reserve and
 * the free space. Categories with named parts (MCP servers, loaded skills) expand to list them.
 * Until the breakdown arrives, the header shows the ring's own numbers so it does not jump; a
 * failed load is said in place of the rows.
 */
export function ContextUsageDetail({
  context,
  breakdown,
  error,
}: {
  context: TaskContextState;
  breakdown: ContextBreakdown | null;
  error: string;
}) {
  const { t } = useTranslation('panel');
  const contextWindow = breakdown ? breakdown.contextWindow : context.contextWindow;
  const used = breakdown ? breakdown.usedTokens : context.tokens;
  const usedText = `${breakdown?.estimated ? '~' : ''}${formatTokenCount(used ?? 0)}`;
  const summary =
    used === null
      ? t('composer.context.percent', { percent: Math.round(context.percent ?? 0) })
      : contextWindow === null
        ? t('composer.context.detail.used', { used: usedText })
        : t('composer.context.detail.usage', {
            used: usedText,
            window: formatContextWindow(contextWindow),
            percent: Math.round((used / contextWindow) * 100),
          });
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <span className="font-medium">{t('composer.context.detail.title')}</span>
        <span className="text-muted-foreground tabular-nums">{summary}</span>
      </div>
      {breakdown && (
        <div className="context-bar h-1.5 shrink-0 overflow-hidden rounded-full">
          <svg
            className="block size-full"
            viewBox={`0 0 ${BAR_UNITS} 1`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {segmentsOf(breakdown).map((segment) => (
              <rect
                key={segment.id}
                className="context-category"
                data-category={segment.id}
                x={segment.x}
                y={0}
                width={segment.width}
                height={1}
              />
            ))}
          </svg>
        </div>
      )}
      {error ? (
        <p className="m-0 text-muted-foreground">
          {t('composer.context.detail.error', { message: error })}
        </p>
      ) : breakdown ? (
        <ContextRows breakdown={breakdown} />
      ) : (
        <p className="m-0 flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {t('composer.context.detail.loading')}
        </p>
      )}
    </div>
  );
}

/**
 * The rows, in a grid of fixed columns (swatch, label, tokens, percent) that an expanded group's
 * list repeats, so the numbers align. The rows scroll when the popover runs out of height, and an
 * expanded list scrolls within a capped height; both are shared `ScrollArea`s with the edge fade
 * whose bars show on hover. Neither reserves a bar lane (`gutter="none"`), since a lane would
 * narrow the columns: the rows reach 12px into the popover's 16px right padding and pad their grid
 * back, so their bar floats in that padding, 4px off the edge, while a list ends where the row
 * text ends, so its bar floats just inside it, beside the rows' bar.
 */
function ContextRows({ breakdown }: { breakdown: ContextBreakdown }) {
  const { t, i18n } = useTranslation('panel');
  const { contextWindow, usedTokens, autocompactBuffer } = breakdown;
  const percent = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const share = (tokens: number) =>
    contextWindow === null ? '—' : percent.format(tokens / contextWindow);
  const free =
    contextWindow === null ? 0 : Math.max(0, contextWindow - usedTokens - autocompactBuffer);
  const cells = (category: ContextBreakdownCategory, expandable: boolean) => (
    <RowCells
      part={category.id}
      label={t(`composer.context.detail.categories.${category.id}`)}
      note={
        category.count === null
          ? null
          : category.id === 'skills'
            ? t('composer.context.detail.skills', { count: category.count })
            : t('composer.context.detail.tools', { count: category.count })
      }
      tokens={category.tokens}
      share={share(category.tokens)}
      expandable={expandable}
    />
  );
  return (
    <ScrollArea scrollShadow gutter="none" className="-mr-3 -ml-1.5">
      <div className="context-rows grid gap-x-3 pr-1.5">
        {breakdown.categories
          .filter((category) => category.tokens > 0 || category.id === 'messages')
          .map((category) =>
            category.items.length === 0 ? (
              <Row key={category.id}>{cells(category, false)}</Row>
            ) : (
              <Collapsible key={category.id} className="col-span-full grid grid-cols-subgrid">
                {/* Hover and focus stay inside the row: it sits on the popover's glass. */}
                <CollapsibleTrigger className="context-row-trigger col-span-full grid grid-cols-subgrid items-center rounded-lg px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-3 focus-visible:inset-ring focus-visible:ring-ring/30 focus-visible:inset-ring-ring focus-visible:ring-inset">
                  {cells(category, true)}
                </CollapsibleTrigger>
                <CollapsibleContent className="col-span-full">
                  {/* Ends where the row text ends (`mr-1.5`), so its bar floats just inside the
                      list, beside the rows' bar in the popover's padding rather than on it; the
                      items drop their right padding to keep the rows' columns. */}
                  <ScrollArea scrollShadow gutter="none" className="mr-1.5 max-h-44">
                    <div className="context-rows context-items grid gap-x-3">
                      {category.items.map((item) => (
                        <div
                          key={item.name}
                          className="col-span-full grid grid-cols-subgrid items-center py-0.5 pl-1.5 text-muted-foreground"
                        >
                          <span />
                          <span className="truncate pl-2" title={item.name}>
                            {item.name}
                          </span>
                          <span className="text-right tabular-nums">
                            {formatTokenCount(item.tokens)}
                          </span>
                          {/* An item has no share of its own; its count takes that column, so
                              the name keeps the label column's whole width. */}
                          <span className="truncate text-right text-xs tabular-nums">
                            {item.count !== null &&
                              t('composer.context.detail.tools', { count: item.count })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            ),
          )}
        {contextWindow !== null && (
          <>
            <Row>
              <RowCells
                part="buffer"
                label={t('composer.context.detail.buffer')}
                note={null}
                tokens={autocompactBuffer}
                share={share(autocompactBuffer)}
              />
            </Row>
            <Row>
              <RowCells
                part="free"
                label={t('composer.context.detail.free')}
                note={null}
                tokens={free}
                share={share(free)}
              />
            </Row>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="col-span-full grid grid-cols-subgrid items-center px-1.5 py-1">{children}</div>
  );
}

/** One row's four cells: swatch, label with its count, tokens, and share of the window. */
function RowCells({
  part,
  label,
  note,
  tokens,
  share,
  expandable = false,
}: {
  part: ContextPart;
  label: string;
  note: string | null;
  tokens: number;
  share: string;
  expandable?: boolean;
}) {
  return (
    <>
      <span className="context-category context-swatch size-2.5 rounded-sm" data-category={part} />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{label}</span>
        {note !== null && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{note}</span>
        )}
        {expandable && (
          <ChevronRight
            className="context-row-chevron size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
      </span>
      <span className="text-right tabular-nums">{formatTokenCount(tokens)}</span>
      <span className="text-right text-muted-foreground tabular-nums">{share}</span>
    </>
  );
}
