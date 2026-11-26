import type { PickedElement } from '../../channel/payloads.ts';
import { labelOf, visibleTextOf } from './describe.ts';
import { Highlight } from './highlight.ts';
import { Picker } from './picker.ts';
import { uniqueSelector } from './selector.ts';

export interface PickHandlers {
  /** The person picked `element`; `picked` is what goes to Atd, or null when no selector fits it. */
  picked(element: Element, picked: PickedElement | null): void;
  /** Esc ended picking without a pick. */
  canceled(): void;
}

/**
 * The in-page ask's inspector: one round of picking an element of the page at a time, with the
 * highlight under the pointer, and the highlight a picked element's chip shows. The ask creates it
 * on first use, so a page where nobody picks never runs any of it.
 */
export class Inspector {
  private readonly highlight = new Highlight();
  private picker: Picker | null = null;
  /** Who the highlight shows for: the picker (the pointer), or a chip. */
  private shownBy: 'picker' | 'chip' | null = null;

  /** Whether the person is choosing an element. */
  get picking(): boolean {
    return this.picker?.picking === true;
  }

  /** Whether the page's pointer events are the picker's: while picking, and briefly after a pick. */
  get capturing(): boolean {
    return this.picker !== null;
  }

  pick(handlers: PickHandlers): void {
    this.stop();
    const picker = new Picker(
      {
        hover: (element) => this.mark(element, 'picker'),
        // The picked element stays marked (and shielded) until the picker lets go.
        picked: (element) => handlers.picked(element, describe(element)),
        canceled: () => handlers.canceled(),
        released: () => {
          if (this.picker === picker) this.picker = null;
          if (this.shownBy === 'picker') this.mark(null, null);
        },
      },
      this.highlight,
    );
    this.picker = picker;
  }

  /** Ends picking (and the short block after a pick) and takes the highlight away. */
  stop(): void {
    this.picker?.dispose();
    this.mark(null, null);
  }

  /** Marks `element` for a chip hovered or focused; null takes a chip's mark away. */
  show(element: Element | null): void {
    if (element !== null) this.mark(element, 'chip');
    else if (this.shownBy === 'chip') this.mark(null, null);
  }

  private mark(element: Element | null, by: 'picker' | 'chip' | null): void {
    this.shownBy = element === null ? null : by;
    this.highlight.show(element, by === 'picker');
  }
}

/** The contract's fields for `element`, read at the moment it is picked. */
function describe(element: Element): PickedElement | null {
  const selector = uniqueSelector(element);
  if (selector === null) return null;
  return { selector, label: labelOf(element), text: visibleTextOf(element) };
}
