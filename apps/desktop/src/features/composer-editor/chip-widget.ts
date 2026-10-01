import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WidgetType } from '@codemirror/view';
import { revealQuote } from '../agent/transcript/selection-toolbar/quote-reveal';
import { ChipContent } from './chip-content';
import { chipName, type Chip } from './draft';

const roots = new WeakMap<HTMLElement, Root>();

/**
 * Renders one chip token into its own React root. The root element stays `inline-block` (an
 * `inline-flex` atom makes Chrome's IME repeat the first character typed after it), and `eq`
 * compares ids so rebuilt decorations keep the existing DOM.
 */
export class ChipWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly chip: Chip,
  ) {
    super();
  }

  override eq(other: ChipWidget): boolean {
    return other.id === this.id;
  }

  toDOM(): HTMLElement {
    const dom = document.createElement('span');
    dom.className = 'composer-chip';
    dom.dataset.kind = this.chip.kind;
    // A quote that knows its passage shows it on click; the click still places the cursor.
    const { chip } = this;
    if (chip.kind === 'quote' && chip.source) {
      const source = chip.source;
      dom.dataset.action = 'reveal';
      dom.addEventListener('click', () => revealQuote(source));
    }
    const root = createRoot(dom);
    root.render(createElement(ChipContent, { kind: this.chip.kind, name: chipName(this.chip) }));
    roots.set(dom, root);
    return dom;
  }

  /** Clicks on a chip place the cursor beside it like on text. */
  override ignoreEvent(): boolean {
    return false;
  }

  override destroy(dom: HTMLElement): void {
    const root = roots.get(dom);
    roots.delete(dom);
    // CodeMirror may destroy widgets during a React commit; unmount once it has finished.
    queueMicrotask(() => root?.unmount());
  }
}
