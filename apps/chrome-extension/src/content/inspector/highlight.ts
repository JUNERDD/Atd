import { h } from '../dom.ts';
import { Layer } from '../hosts.ts';
import { signal } from '../lifetime.ts';
import { reducedMotion } from '../motion.ts';
import { labelOf } from './describe.ts';
import inspectorCss from './inspector.css?inline';

/** Elements whose content is another document, which this window's events never reach. */
const FRAMES = new Set(['iframe', 'frame', 'embed', 'object']);
/** The label's height (`inspector.css`), and how far it stands from the box and the edges. */
const TAG_HEIGHT = 20;
const GAP = 4;
const APPEAR_MS = 120;

/**
 * The inspector's highlight: a box over one element of the page with a small label (what it is,
 * and its size), in Atd's own layer, which takes no pointer events, except the box over an
 * embedded document while picking (the picker's `Shield`). It follows the element as the page
 * scrolls or resizes, only while it shows; the layer is in the page only then. It reads the
 * element's box and, when the element changes, its label; nothing else.
 */
export class Highlight {
  private readonly layer = new Layer('atd-inspector', [inspectorCss]);
  private readonly box = h('div', { class: 'pick-box', attrs: { hidden: true } });
  private readonly name = h('span', { class: 'pick-name' });
  private readonly size = h('span', { class: 'pick-size' });
  private readonly tag = h(
    'div',
    { class: 'pick-tag', attrs: { hidden: true } },
    this.name,
    this.size,
  );
  private element: Element | null = null;
  private follow: AbortController | null = null;
  private frame = 0;

  constructor() {
    this.layer.root.setAttribute('aria-hidden', 'true');
    this.layer.root.append(this.box, this.tag);
  }

  /** Whether `node` is the highlight's layer host (the shield, from the page's side). */
  hosts(node: unknown): boolean {
    return this.layer.hosts(node);
  }

  /**
   * Marks `element`, or with null takes the highlight away. `picking`: the box over an embedded
   * document takes the pointer, so a click there reaches the picker rather than the frame.
   */
  show(element: Element | null, picking = false): void {
    if (element === null) return this.hide();
    this.box.toggleAttribute('data-shield', picking && FRAMES.has(element.localName));
    if (element !== this.element) {
      this.element = element;
      this.name.textContent = labelOf(element);
    }
    if (this.follow === null) {
      this.follow = new AbortController();
      const options = {
        capture: true,
        passive: true,
        signal: AbortSignal.any([this.follow.signal, signal]),
      };
      addEventListener('scroll', () => this.schedule(), options);
      addEventListener('resize', () => this.schedule(), options);
    }
    this.layer.mount();
    this.place();
  }

  private hide(): void {
    this.element = null;
    this.follow?.abort();
    this.follow = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.box.hidden = true;
    this.tag.hidden = true;
    this.layer.unmount();
  }

  private schedule(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.place();
    });
  }

  /** Puts the box over the element and its label above it (below, or inside, where no room). */
  private place(): void {
    const element = this.element;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const onScreen =
      element.isConnected &&
      (rect.width > 0 || rect.height > 0) &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= innerHeight &&
      rect.left <= innerWidth;
    const appearing = this.box.hidden === true;
    this.box.hidden = !onScreen;
    this.tag.hidden = !onScreen;
    if (!onScreen) return;
    // A box that just appeared stands where its element is; it glides only from one to the next.
    this.layer.root.toggleAttribute('data-instant', appearing);
    const box = this.box.style;
    box.setProperty('translate', `${rect.left}px ${rect.top}px`);
    box.setProperty('width', `${rect.width}px`);
    box.setProperty('height', `${rect.height}px`);
    const size = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    if (this.size.textContent !== size) this.size.textContent = size;
    const above = rect.top - GAP - TAG_HEIGHT;
    const below = rect.bottom + GAP;
    const top =
      above >= GAP
        ? above
        : below + TAG_HEIGHT <= innerHeight - GAP
          ? below
          : Math.max(rect.top, 0) + GAP;
    this.tag.style.setProperty('--x', `${Math.max(rect.left, GAP)}px`);
    this.tag.style.setProperty('--y', `${top}px`);
    if (!appearing || reducedMotion()) return;
    for (const piece of [this.box, this.tag]) {
      piece.animate({ opacity: [0, 1] }, { duration: APPEAR_MS, easing: 'ease-out' });
    }
  }
}
