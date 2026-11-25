import { X, Check, Copy, createElement } from 'lucide';
import { focusedAct, gbtn, h, iconAttrs, refocus } from '../dom.ts';
import { t } from '../i18n.ts';
import { atdMark } from '../mark.ts';

export type ResultState =
  | { state: 'working' }
  | { state: 'done'; text: string }
  | { state: 'failed'; message: string };

export interface ResultEvents {
  copy(text: string): void;
  /** Continue in Atd: the command's task when known, else the app. */
  continueInAtd(): void;
  dismiss(): void;
}

/**
 * A selection command's result in place, below the selection: "Working…" while Atd runs it, then
 * its text (Copy, Continue in Atd) or why it failed. A dialog, named after the command.
 */
export class ResultCard {
  readonly node: HTMLDivElement;
  private title = '';
  private result: ResultState = { state: 'working' };
  private copied = false;

  constructor(
    private readonly events: ResultEvents,
    private readonly effects: () => boolean,
  ) {
    this.node = h('div', { class: 'sel-result glass', attrs: { role: 'dialog', hidden: true } });
  }

  get isOpen(): boolean {
    return !this.node.hidden;
  }

  open(title: string, below: DOMRect): void {
    this.title = title;
    this.result = { state: 'working' };
    this.copied = false;
    this.node.hidden = false;
    this.render();
    const width = this.node.offsetWidth;
    const height = this.node.offsetHeight;
    const x = Math.max(12, Math.min(below.left, innerWidth - width - 12));
    const fitsBelow = below.bottom + 10 + height <= innerHeight - 8;
    const y = fitsBelow ? below.bottom + 10 : Math.max(8, below.top - height - 10);
    this.node.style.setProperty('left', `${x}px`);
    this.node.style.setProperty('top', `${y}px`);
  }

  set(result: ResultState): void {
    this.result = result;
    this.render();
  }

  markCopied(): void {
    this.copied = true;
    this.render();
    window.setTimeout(() => {
      this.copied = false;
      if (this.isOpen) this.render();
    }, 1500);
  }

  close(): void {
    this.node.hidden = true;
    this.node.replaceChildren();
  }

  relabel(): void {
    if (this.isOpen) this.render();
  }

  private render(): void {
    const result = this.result;
    const root = this.node.getRootNode();
    const focused = root instanceof ShadowRoot ? focusedAct(root.activeElement) : null;
    this.build(result);
    refocus(this.node, focused);
  }

  private build(result: ResultState): void {
    this.node.setAttribute('aria-label', this.title);
    const text =
      result.state === 'working'
        ? h('div', { class: this.effects() ? 'text shimmer' : 'text' }, t('common.working'))
        : result.state === 'done'
          ? h('div', { class: 'text', attrs: { tabindex: 0 } }, result.text)
          : h('div', { class: 'text failed', attrs: { role: 'alert' } }, result.message);
    this.node.replaceChildren(
      h(
        'div',
        { class: 'head' },
        atdMark(14),
        h('span', {}, t('selection.fromSelection', { title: this.title })),
      ),
      text,
      h(
        'div',
        { class: 'acts' },
        gbtn({
          act: 'copy',
          label: this.copied ? t('common.copied') : t('common.copy'),
          icon: createElement(this.copied ? Check : Copy, iconAttrs(13)),
          disabled: result.state !== 'done',
          onClick: () => {
            if (result.state === 'done') this.events.copy(result.text);
          },
        }),
        gbtn({
          act: 'continue',
          label: t('selection.continueInAtd'),
          onClick: () => this.events.continueInAtd(),
        }),
        gbtn({
          act: 'dismiss',
          variant: 'icon',
          label: t('common.dismiss'),
          icon: createElement(X, iconAttrs(14)),
          onClick: () => this.events.dismiss(),
        }),
      ),
    );
  }
}
