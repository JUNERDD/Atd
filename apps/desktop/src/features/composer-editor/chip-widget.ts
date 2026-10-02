import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Transaction } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import { revealQuote } from '../agent/transcript/selection-toolbar/quote-reveal';
import { ChipContent } from './chip-content';
import { editImageChip, isEditableImage } from './chip-image-edit';
import { chipName, type Chip } from './draft';

const mounted = new WeakMap<HTMLElement, { root: Root; resize: ResizeObserver }>();

/**
 * Renders one chip token into its own React root. The root element stays `inline-block` (an
 * `inline-flex` atom makes Chrome's IME repeat the first character typed after it), and `eq`
 * compares ids so rebuilt decorations keep the existing DOM.
 *
 * React renders the root asynchronously, so CodeMirror can measure the cursor beside a chip that
 * is still an empty shell (after a capture, for one). The drawn cursor is measured again only for
 * a document, selection or line-height change, and a chip widening on its line is none of them,
 * so the cursor would stay over the chip: each chip re-applies the selection when its size
 * changes, which redraws the cursor and is not an undo step. Never during an IME composition.
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

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('span');
    dom.className = 'composer-chip';
    dom.dataset.kind = this.chip.kind;
    // A quote that knows its passage shows it on click, and an image opens the screenshot editor;
    // the click still places the cursor.
    const { chip, id } = this;
    const image = isEditableImage(chip);
    if (chip.kind === 'quote' && chip.source) {
      const source = chip.source;
      dom.dataset.action = 'reveal';
      dom.addEventListener('click', () => revealQuote(source));
    } else if (image) {
      dom.dataset.action = 'edit';
      dom.addEventListener('click', () => void editImageChip(view, id, chip));
    }
    const root = createRoot(dom);
    root.render(createElement(ChipContent, { kind: chip.kind, name: chipName(chip), image }));
    const resize = new ResizeObserver(() => {
      if (view.composing) return;
      view.dispatch({
        selection: view.state.selection,
        annotations: Transaction.addToHistory.of(false),
      });
    });
    resize.observe(dom);
    mounted.set(dom, { root, resize });
    return dom;
  }

  /** Clicks on a chip place the cursor beside it like on text. */
  override ignoreEvent(): boolean {
    return false;
  }

  override destroy(dom: HTMLElement): void {
    const chip = mounted.get(dom);
    mounted.delete(dom);
    chip?.resize.disconnect();
    // CodeMirror may destroy widgets during a React commit; unmount once it has finished.
    queueMicrotask(() => chip?.root.unmount());
  }
}
