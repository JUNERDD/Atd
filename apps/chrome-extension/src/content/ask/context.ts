import { Globe, Plus, SquareMousePointer, X, createElement, type IconNode } from 'lucide';
import type { PickedElement } from '../../channel/payloads.ts';
import { h, iconAttrs } from '../dom.ts';
import { t } from '../i18n.ts';
import { atdMark } from '../mark.ts';

/** The most elements one request carries (the `ask` frame's `elements`). */
export const MAX_ELEMENTS = 5;

export interface ContextEvents {
  /** The person added or removed something: the field takes focus back, the HUD follows. */
  changed(): void;
  /** A picked element's chip is hovered or focused (its element, if the page still has it), or no longer is. */
  highlight(element: Element | null): void;
}

/**
 * One picked element: what goes to Atd (read when it was picked), and the element itself, held
 * weakly, so a page that removes it is not kept from freeing it.
 */
interface Picked {
  element: WeakRef<Element>;
  data: PickedElement;
}

/**
 * What goes with the in-page ask besides its text: the page (its URL and title: the page chip) and
 * the elements picked on it (a chip each). Elements are part of the page, so picking one includes
 * the page again, and leaving the page out drops them. The chips fill the composer's meta row after
 * the Atd mark; `trailing` (the length count) stays last.
 */
export class AskContext {
  includePage = true;
  private picked: Picked[] = [];
  private host = '';

  constructor(
    private readonly meta: HTMLElement,
    private readonly trailing: HTMLElement,
    private readonly events: ContextEvents,
  ) {}

  /** Shows the page as `host` (the tab's site). */
  setHost(host: string): void {
    this.host = host;
    this.render();
  }

  get full(): boolean {
    return this.picked.length >= MAX_ELEMENTS;
  }

  has(element: Element): boolean {
    return this.picked.some((entry) => entry.element.deref() === element);
  }

  /** Adds a picked element (never twice, at most `MAX_ELEMENTS`), and the page with it. */
  add(element: Element, data: PickedElement): void {
    const twice = this.picked.some((entry) => entry.data.selector === data.selector);
    if (this.full || twice || this.has(element)) return;
    this.picked.push({ element: new WeakRef(element), data });
    this.includePage = true;
    this.render();
  }

  /** The elements that go with the request: only together with the page. */
  elements(): PickedElement[] {
    return this.includePage ? this.picked.map((entry) => entry.data) : [];
  }

  /** After Atd took the request: the page again, and no elements. */
  reset(): void {
    this.includePage = true;
    this.drop();
    this.render();
  }

  render(): void {
    const chips: HTMLElement[] = [
      h('span', { class: 'ask-mark', attrs: { 'aria-hidden': 'true' } }, atdMark(16)),
    ];
    if (this.includePage) {
      if (this.host) {
        const leave = () => {
          this.includePage = false;
          this.drop();
        };
        chips.push(chip(this.host, Globe, t('ask.removePage'), 'page', () => this.change(leave)));
      }
      for (const entry of this.picked) chips.push(this.elementChip(entry));
    } else if (this.host) {
      chips.push(
        h(
          'button',
          {
            class: 'ask-chip add',
            attrs: { type: 'button', 'data-act': 'page' },
            on: { click: () => this.change(() => (this.includePage = true)) },
          },
          createElement(Plus, iconAttrs(12)),
          h('span', { class: 'name' }, t('ask.addPage')),
        ),
      );
    }
    this.meta.replaceChildren(...chips, this.trailing);
  }

  /** A picked element's chip: hovering or focusing it marks its element on the page again. */
  private elementChip(entry: Picked): HTMLElement {
    const { label } = entry.data;
    const remove = () => {
      this.picked = this.picked.filter((other) => other !== entry);
      this.events.highlight(null);
    };
    const node = chip(label, SquareMousePointer, t('ask.removeElement', { label }), 'element', () =>
      this.change(remove),
    );
    node.classList.add('element');
    const show = () => this.events.highlight(entry.element.deref() ?? null);
    const hide = () => this.events.highlight(null);
    node.addEventListener('mouseenter', show);
    node.addEventListener('mouseleave', hide);
    node.addEventListener('focusin', show);
    node.addEventListener('focusout', hide);
    return node;
  }

  private drop(): void {
    this.picked = [];
    this.events.highlight(null);
  }

  private change(apply: () => void): void {
    apply();
    this.render();
    this.events.changed();
  }
}

/** A removable chip: its icon and name (the full name on hover), then its remove button. */
function chip(
  label: string,
  icon: IconNode,
  removeLabel: string,
  act: string,
  remove: () => void,
): HTMLElement {
  return h(
    'span',
    { class: 'ask-chip', attrs: { title: label } },
    createElement(icon, iconAttrs(12)),
    h('span', { class: 'name' }, label),
    h(
      'button',
      {
        class: 'x',
        attrs: { type: 'button', 'aria-label': removeLabel, title: removeLabel, 'data-act': act },
        on: { click: remove },
      },
      createElement(X, iconAttrs(12)),
    ),
  );
}
