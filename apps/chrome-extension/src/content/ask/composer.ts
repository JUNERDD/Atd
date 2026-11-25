import { ArrowUp, Globe, Plus, X, createElement } from 'lucide';
import { h, iconAttrs } from '../dom.ts';
import { currentDocumentLanguage, t } from '../i18n.ts';
import { atdMark } from '../mark.ts';

/** The field grows with its text up to this height, then scrolls. */
const MAX_FIELD_HEIGHT = 110;
/**
 * The longest request the field takes (typing and pasting stop there), below the 100 000
 * characters Atd accepts so the page's URL and title still fit beside it.
 */
const MAX_TEXT = 90_000;
/** From this length the field shows how much of the limit is used. */
const COUNT_FROM = 80_000;
const COUNT_ID = 'atd-ask-count';

export interface ComposerEvents {
  submit(): void;
  /** Esc: close and hand focus back to where the person was. */
  escape(): void;
  /** The draft or its context changed (the send button and the HUD's size follow). */
  changed(): void;
}

/**
 * The in-page ask's field: the request on top; below it the Atd mark, the page chip (removable:
 * the request then goes without the page's URL and title) and the send button. It stays one element for the life of the tab, so a re-render never loses the caret or an
 * IME composition; the HUD swaps it in and out. Key events stop here: a page's shortcuts must not
 * fire while the person types into Atd's field.
 */
export class Composer {
  readonly node: HTMLDivElement;
  readonly field: HTMLTextAreaElement;
  private readonly meta: HTMLDivElement;
  private readonly send: HTMLButtonElement;
  private readonly note: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private host = '';
  includePage = true;
  private busy = false;
  private allowed = true;

  constructor(private readonly events: ComposerEvents) {
    this.field = h('textarea', {
      class: 'ask-input',
      attrs: {
        rows: 1,
        enterkeyhint: 'send',
        maxlength: MAX_TEXT,
        'aria-describedby': COUNT_ID,
        'data-act': 'field',
      },
      on: {
        input: () => {
          this.fit();
          this.sync();
          this.events.changed();
        },
        keydown: (event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            this.events.submit();
          }
        },
      },
    });
    this.meta = h('div', { class: 'ask-meta' });
    this.count = h('span', { class: 'ask-count', attrs: { id: COUNT_ID, hidden: true } });
    this.send = h(
      'button',
      {
        class: 'ask-send',
        attrs: { type: 'button', 'data-act': 'send' },
        on: { click: () => this.events.submit() },
      },
      createElement(ArrowUp, iconAttrs(16)),
    );
    this.note = h('div', { class: 'ask-note', attrs: { hidden: true, role: 'alert' } });
    this.node = h('div', { class: 'ask-box' }, this.field, this.meta, this.send, this.note);
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      this.node.addEventListener(type, (event) => {
        if (type === 'keydown' && event.key === 'Escape') {
          event.preventDefault();
          this.events.escape();
        }
        event.stopPropagation();
      });
    }
    this.relabel();
  }

  get text(): string {
    return this.field.value.trim();
  }

  /** Opens for `host` (the tab's site). */
  prepare(host: string): void {
    this.host = host;
    this.note.hidden = true;
    this.renderMeta();
  }

  /** After Atd took the request: a fresh draft next time. */
  reset(): void {
    this.field.value = '';
    this.includePage = true;
    this.renderMeta();
    this.sync();
    this.fit();
  }

  focus(): void {
    this.field.focus({ preventScroll: true });
    const end = this.field.value.length;
    this.field.setSelectionRange(end, end);
    // Measured only once the capsule is laid out (it is hidden before it opens).
    this.fit();
  }

  /** While the request is on its way, or when Atd can't take one now, nothing more is sent. */
  setState(busy: boolean, allowed: boolean): void {
    this.busy = busy;
    this.allowed = allowed;
    this.field.readOnly = busy;
    this.sync();
  }

  setError(message: string | null): void {
    this.note.textContent = message ?? '';
    this.note.hidden = message === null;
  }

  relabel(): void {
    this.field.setAttribute('aria-label', t('ask.label'));
    this.field.placeholder = t('ask.placeholder');
    this.send.setAttribute('aria-label', t('ask.send'));
    this.send.title = t('ask.send');
    this.renderMeta();
    this.sync();
  }

  get canSend(): boolean {
    return this.text.length > 0 && !this.busy && this.allowed;
  }

  private sync(): void {
    this.send.disabled = !this.canSend;
    const length = this.field.value.length;
    this.count.hidden = length < COUNT_FROM;
    if (this.count.hidden) return;
    const format = new Intl.NumberFormat(currentDocumentLanguage());
    this.count.textContent = t('ask.count', {
      used: format.format(length),
      limit: format.format(MAX_TEXT),
    });
    this.count.classList.toggle('full', length >= MAX_TEXT);
  }

  private fit(): void {
    this.field.style.setProperty('height', 'auto');
    const height = Math.min(this.field.scrollHeight, MAX_FIELD_HEIGHT);
    this.field.style.setProperty('height', `${Math.max(height, 22)}px`);
  }

  private renderMeta(): void {
    const chips: HTMLElement[] = [
      h('span', { class: 'ask-mark', attrs: { 'aria-hidden': 'true' } }, atdMark(16)),
    ];
    if (this.includePage && this.host) {
      chips.push(
        this.chip(
          this.host,
          createElement(Globe, iconAttrs(12)),
          t('ask.removePage'),
          'page',
          () => {
            this.includePage = false;
          },
        ),
      );
    } else if (this.host) {
      chips.push(
        h(
          'button',
          {
            class: 'ask-chip add',
            attrs: { type: 'button', 'data-act': 'page' },
            on: {
              click: () =>
                this.toggled(() => {
                  this.includePage = true;
                }),
            },
          },
          createElement(Plus, iconAttrs(12)),
          h('span', { class: 'name' }, t('ask.addPage')),
        ),
      );
    }
    this.meta.replaceChildren(...chips, this.count);
  }

  private chip(
    label: string,
    icon: Element,
    removeLabel: string,
    act: string,
    remove: () => void,
  ): HTMLElement {
    return h(
      'span',
      { class: 'ask-chip', attrs: { title: label } },
      icon,
      h('span', { class: 'name' }, label),
      h(
        'button',
        {
          class: 'x',
          attrs: { type: 'button', 'aria-label': removeLabel, title: removeLabel, 'data-act': act },
          on: { click: () => this.toggled(remove) },
        },
        createElement(X, iconAttrs(12)),
      ),
    );
  }

  private toggled(change: () => void): void {
    change();
    this.renderMeta();
    this.field.focus({ preventScroll: true });
    this.events.changed();
  }
}
