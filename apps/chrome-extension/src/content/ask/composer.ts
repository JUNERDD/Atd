import {
  ArrowUp,
  PanelRightOpen,
  PanelTopOpen,
  SquareDashedMousePointer,
  createElement,
  type IconNode,
} from 'lucide';
import type { PanelSurface } from '../../messages/views.ts';
import { h, iconAttrs } from '../dom.ts';
import { currentDocumentLanguage, t } from '../i18n.ts';
import { AskContext, MAX_ELEMENTS } from './context.ts';
import { panelLabel } from './status.ts';

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
const STATUS_ID = 'atd-ask-status';

export interface ComposerEvents {
  submit(): void;
  /** Esc: close and hand focus back to where the person was. */
  escape(): void;
  /** The draft or its context changed (the send button and the HUD's size follow). */
  changed(): void;
  /** The inspector control: start picking an element of the page, or stop. */
  inspect(): void;
  /** Open Atd's panel (the side panel, or the toolbar popup where a browser has none). */
  openPanel(): void;
  /** A picked element's chip is hovered or focused (its element), or no longer is (null). */
  highlight(element: Element | null): void;
}

/**
 * The in-page ask's field: the request on top; below it the Atd mark and the context chips (the
 * page, removable, and the elements picked on it: `context.ts`), the inspector and the panel
 * controls, and the send button; under them why Atd cannot take a request now (or how picking
 * works, while it does), then a failure. It stays one element for the life of the tab, so a
 * re-render never loses the caret or an IME composition; the HUD swaps it in and out. Key events
 * stop here: a page's shortcuts must not fire while the person types into Atd's field.
 */
export class Composer {
  readonly node: HTMLDivElement;
  readonly field: HTMLTextAreaElement;
  readonly context: AskContext;
  private readonly send: HTMLButtonElement;
  private readonly inspector: HTMLButtonElement;
  private readonly panelButton: HTMLButtonElement;
  private readonly status: HTMLDivElement;
  private readonly statusText: HTMLSpanElement;
  private readonly statusPanel: HTMLButtonElement;
  private readonly note: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private busy = false;
  private allowed = true;
  private picking = false;
  private blocked: string | null = null;
  /** Where Atd's panel opens from here; `undefined` until the first view says. */
  private panel: PanelSurface | null | undefined;

  constructor(private readonly events: ComposerEvents) {
    this.field = h('textarea', {
      class: 'ask-input',
      attrs: {
        rows: 1,
        enterkeyhint: 'send',
        maxlength: MAX_TEXT,
        'aria-describedby': `${STATUS_ID} ${COUNT_ID}`,
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
    const meta = h('div', { class: 'ask-meta' });
    this.count = h('span', { class: 'ask-count', attrs: { id: COUNT_ID, hidden: true } });
    this.context = new AskContext(meta, this.count, {
      changed: () => {
        this.field.focus({ preventScroll: true });
        this.sync();
        this.events.changed();
      },
      highlight: (element) => this.events.highlight(element),
    });
    this.inspector = tool('inspect', SquareDashedMousePointer, () => this.events.inspect());
    this.panelButton = tool('panel', PanelRightOpen, () => this.events.openPanel());
    this.panelButton.hidden = true;
    const tools = h('div', { class: 'ask-tools' }, this.inspector, this.panelButton);
    this.send = h(
      'button',
      {
        class: 'ask-send',
        attrs: { type: 'button', 'data-act': 'send' },
        on: { click: () => this.events.submit() },
      },
      createElement(ArrowUp, iconAttrs(16)),
    );
    this.statusText = h('span', { class: 'text' });
    this.statusPanel = h('button', {
      class: 'gbtn outline',
      attrs: { type: 'button', 'data-act': 'statusPanel' },
      on: { click: () => this.events.openPanel() },
    });
    this.status = h(
      'div',
      { class: 'ask-status', attrs: { id: STATUS_ID, hidden: true, role: 'status' } },
      this.statusText,
      this.statusPanel,
    );
    this.note = h('div', { class: 'ask-note', attrs: { hidden: true, role: 'alert' } });
    this.node = h('div', { class: 'ask-box' }, this.field, meta, tools, this.send);
    this.node.append(this.status, this.note);
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
    this.note.hidden = true;
    this.context.setHost(host);
  }

  /** After Atd took the request: a fresh draft next time. */
  reset(): void {
    this.field.value = '';
    this.context.reset();
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

  /** Why Atd cannot take a request now (null: it can), and where its panel opens from here. */
  setBlocked(reason: string | null, panel: PanelSurface | null): void {
    this.blocked = reason;
    if (panel !== this.panel) {
      this.panel = panel;
      this.panelButton.hidden = panel === null;
      const icon = panel === 'popup' ? PanelTopOpen : PanelRightOpen;
      this.panelButton.replaceChildren(createElement(icon, iconAttrs(16)));
    }
    this.sync();
  }

  /** The inspector is picking: its control shows pressed and the status row says how it works. */
  setPicking(picking: boolean): void {
    this.picking = picking;
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
    this.context.render();
    this.sync();
  }

  get canSend(): boolean {
    return this.text.length > 0 && !this.busy && this.allowed;
  }

  private sync(): void {
    this.send.disabled = !this.canSend;
    this.syncTools();
    this.syncStatus();
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

  private syncTools(): void {
    const full = this.context.full && !this.picking;
    const inspect = this.picking
      ? t('ask.stopPicking')
      : full
        ? t('ask.elementsFull', { max: MAX_ELEMENTS })
        : t('ask.pick');
    this.inspector.disabled = this.busy || full;
    this.inspector.setAttribute('aria-pressed', String(this.picking));
    name(this.inspector, inspect);
    if (this.panel) name(this.panelButton, panelLabel(this.panel));
  }

  /** While picking, how it works; else why Atd cannot take a request, with the way to its panel. */
  private syncStatus(): void {
    const text = this.picking ? t('ask.picking') : this.blocked;
    this.status.hidden = text === null;
    this.statusText.textContent = text ?? '';
    const panel = this.picking || this.blocked === null ? null : (this.panel ?? null);
    this.statusPanel.hidden = panel === null;
    if (panel !== null) this.statusPanel.textContent = panelLabel(panel);
  }

  private fit(): void {
    this.field.style.setProperty('height', 'auto');
    const height = Math.min(this.field.scrollHeight, MAX_FIELD_HEIGHT);
    this.field.style.setProperty('height', `${Math.max(height, 22)}px`);
  }
}

/** One of the composer's icon controls, named by `name` (its tooltip too). */
function tool(act: string, icon: IconNode, onClick: () => void): HTMLButtonElement {
  return h(
    'button',
    { class: 'ask-tool', attrs: { type: 'button', 'data-act': act }, on: { click: onClick } },
    createElement(icon, iconAttrs(16)),
  );
}

function name(button: HTMLButtonElement, label: string): void {
  button.setAttribute('aria-label', label);
  button.title = label;
}
