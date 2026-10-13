import { Check, ChevronDown } from 'lucide-react';
import '../tokens.css';
import './select.css';

/** The `SelectTrigger` at its default size, full width: the value, then the muted chevron. */
export function SelectTrigger({ value }: { value: string }) {
  return (
    <span className="rsel-trigger">
      <span className="rsel-trigger__value">{value}</span>
      <ChevronDown className="pk-icon rsel-trigger__chevron" />
    </span>
  );
}

interface SelectMenuProps {
  /** The items in order; `null` is a separator between groups. Indexes count separators too. */
  items: readonly (string | null)[];
  /** The chosen item, which carries the check. */
  selected: number;
  /** The item under the pointer or keyboard focus, drawn with the glass wash; null for none. */
  highlighted: number | null;
  /** The menu's fade as it opens and closes, 0 → 1. */
  opacity: number;
  /** Items that cannot be chosen here (half opacity), as the panel's run-output field has them. */
  disabled?: readonly number[] | undefined;
}

/**
 * `SelectContent` in popper position (`packages/ui/src/components/select.tsx`): glass with an
 * 18 pt corner and 4 pt of padding, 4 pt below the trigger and at least its width; each item a
 * 14 pt corner row with the check at its trailing edge. Place it in a positioned box over the
 * trigger; it opens downward.
 */
export function SelectMenu({ items, selected, highlighted, opacity, disabled }: SelectMenuProps) {
  if (opacity <= 0) return null;
  return (
    <div className="glass rsel-menu" style={{ '--o': opacity }}>
      {items.map((item, index) =>
        item === null ? (
          <i key={index} className="rsel-separator" />
        ) : (
          <div
            key={index}
            className="rsel-item"
            data-highlighted={index === highlighted || undefined}
            data-disabled={disabled?.includes(index) || undefined}
          >
            <span>{item}</span>
            {index === selected && <Check className="pk-icon rsel-item__check" />}
          </div>
        ),
      )}
    </div>
  );
}
