import { Check, ChevronRight } from 'lucide-react';
import type { Point } from '../world/points.ts';
import { hasSlot, menuRowWidth, type MenuItem } from './options-menu.ts';
import './tokens.css';
import './options-menu.css';

interface OptionsMenuProps {
  /** The menu's top-left, in the layer's points. */
  origin: Point;
  items: readonly MenuItem[];
  /** The row under the pointer (9% wash), the row held down (16%), and the row whose submenu is open (9%). */
  hover?: number | undefined;
  pressed?: number | undefined;
  active?: number | undefined;
}

/**
 * One of the selection toolbar's menus (`ToolbarOptionsRow`, `ToolbarOptionsSeparator`) on the
 * toolbar's glass, corner 18 so its corners nest with the rows' capsules. A row is its title, its
 * secondary detail, and its trailing slot with the check (label colour) or the submenu chevron
 * (secondary). Menus open and close at once, with no animation, as the shipped ones do.
 */
export function OptionsMenu({ origin, items, hover, pressed, active }: OptionsMenuProps) {
  const wash = (index: number) =>
    pressed === index ? 'pressed' : hover === index || active === index ? 'hover' : undefined;
  return (
    <div
      className="glass pk-menu"
      style={{ '--x': origin.x, '--y': origin.y, '--rw': menuRowWidth(items) }}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <i key={index} className="pk-menu__separator" />
        ) : (
          <span
            key={index}
            className="pk-menu__row"
            data-wash={wash(index)}
            data-detail={item.detail ? '' : undefined}
          >
            <span className="pk-menu__title">{item.title}</span>
            {item.detail ? <span className="pk-menu__detail">{item.detail}</span> : null}
            {hasSlot(item) ? (
              <span className="pk-menu__slot">
                {item.submenu ? (
                  <ChevronRight className="pk-menu__chevron" strokeWidth={2.6} />
                ) : item.mark === 'check' ? (
                  <Check className="pk-menu__check" strokeWidth={2.5} />
                ) : null}
              </span>
            ) : null}
          </span>
        ),
      )}
    </div>
  );
}
