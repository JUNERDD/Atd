import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { IslandKeycap } from './IslandCapsules.tsx';
import { ISLAND } from './island-metrics.ts';
import { cardHints, cardSelection, hasFilter, type OptionsCardSpec } from './island-layout.ts';
import { strings } from './strings.ts';

interface OptionsCardProps {
  lang: Lang;
  card: OptionsCardSpec;
  /** Seconds on the island's clock: the highlight follows the card's moves. */
  t: number;
}

/**
 * A card's footer (`IslandCard`, `IslandAnswerCard`): 4 pt in, its key hints 10 pt apart, then
 * its buttons at the trailing edge.
 */
export function CardFooter({
  hints,
  children,
}: {
  hints: readonly [string, string][];
  children?: ReactNode;
}) {
  return (
    <span className="pk-options__footer">
      {hints.map(([key, text]) => (
        <span key={key} className="pk-options__hint">
          <IslandKeycap symbol={key} />
          {text}
        </span>
      ))}
      {children}
    </span>
  );
}

/**
 * The options card the island grows into (`IslandCard.swift`): 6 pt padding, a 28 pt title row,
 * a filter field over a list of more than six values, a 28 pt row per value or option (at most
 * eight show; the highlight a 10% wash), then 4 pt and a 32 pt footer of key hints beside Run.
 * A list's or a drill-down's row ends with the check on the remembered value and its number for
 * 1–9, both at the trailing edge where every mark of the card sits; a sheet's row ends with what
 * its option shows now.
 */
export function OptionsCard({ lang, card, t }: OptionsCardProps) {
  const s = strings[lang].command;
  const selected = cardSelection(card, t);
  const sheet = card.page === 'sheet';
  const rows = card.values.slice(0, ISLAND.card.maxRows);
  return (
    <div className="pk-options">
      <span className="pk-options__title">{card.title}</span>
      {hasFilter(card) ? (
        <span className="pk-options__filter" data-empty={card.filter ? undefined : ''}>
          {card.filter || s.filter}
        </span>
      ) : null}
      {rows.map((value, index) => (
        <span
          key={value}
          className="pk-options__row"
          data-selected={index === selected || undefined}
        >
          <span className="pk-options__value">{value}</span>
          {sheet ? (
            <span className="pk-options__detail">{card.details?.[index] ?? ''}</span>
          ) : (
            <span className="pk-options__marks">
              <Check className="pk-options__check" data-on={index === card.current || undefined} />
              {index < 9 ? <span className="pk-options__digit">{index + 1}</span> : null}
            </span>
          )}
        </span>
      ))}
      <CardFooter hints={cardHints(lang, card.page)}>
        {card.page === 'drill' ? null : (
          <span className="pk-options__run" data-rest="">
            {s.run}
            <IslandKeycap symbol="↩" />
          </span>
        )}
      </CardFooter>
    </div>
  );
}
