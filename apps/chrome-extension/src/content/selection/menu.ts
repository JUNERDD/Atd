import type { CommandItem } from '../../channel/payloads.ts';
import { h } from '../dom.ts';
import { t } from '../i18n.ts';

export interface MenuEvents {
  pick(command: CommandItem): void;
  /** Escape returns focus to the menu's button; Tab and picks let it move on. */
  close(restoreFocus: boolean): void;
}

/**
 * The person's own Atd commands offered on selected text, under the bar's chevron: a `menu` of
 * `menuitem`s with roving focus (arrows, Home, End), Enter or Space to run one, Escape or Tab to
 * leave. Each shows the command's shortcut when it has one.
 */
export class CommandMenu {
  readonly node: HTMLDivElement;
  private items: CommandItem[] = [];

  constructor(private readonly events: MenuEvents) {
    this.node = h('div', {
      class: 'sel-menu glass',
      attrs: { role: 'menu', hidden: true },
      on: { keydown: (event) => this.key(event) },
    });
  }

  get isOpen(): boolean {
    return !this.node.hidden;
  }

  open(items: readonly CommandItem[], left: number, top: number, focusFirst: boolean): void {
    this.node.hidden = false;
    this.render(items);
    const width = this.node.offsetWidth;
    const height = this.node.offsetHeight;
    const x = Math.max(8, Math.min(left, innerWidth - width - 8));
    const y = top + height > innerHeight - 8 ? Math.max(8, top - height - 46) : top;
    this.node.style.setProperty('left', `${x}px`);
    this.node.style.setProperty('top', `${y}px`);
    if (focusFirst) this.buttons()[0]?.focus({ preventScroll: true });
  }

  /** New commands arrived while open: the list follows, focus stays on the same position. */
  update(items: readonly CommandItem[]): void {
    if (!this.isOpen) return;
    const root = this.node.getRootNode();
    const active = root instanceof ShadowRoot ? root.activeElement : null;
    const index = this.buttons().findIndex((button) => button === active);
    this.render(items);
    if (index >= 0)
      this.buttons()[Math.min(index, this.items.length - 1)]?.focus({ preventScroll: true });
  }

  close(): void {
    this.node.hidden = true;
  }

  private render(items: readonly CommandItem[]): void {
    this.items = [...items];
    this.node.setAttribute('aria-label', t('selection.yourCommands'));
    const rows: HTMLElement[] = [
      h('div', { class: 'lbl', attrs: { role: 'presentation' } }, t('selection.yourCommands')),
    ];
    if (items.length === 0) {
      rows.push(
        h('div', { class: 'empty', attrs: { role: 'presentation' } }, t('selection.noCommands')),
      );
    }
    items.forEach((item, index) => {
      rows.push(
        h(
          'button',
          {
            attrs: {
              type: 'button',
              role: 'menuitem',
              tabindex: -1,
              'data-act': `command-${index}`,
            },
            on: { click: () => this.events.pick(item) },
          },
          h('span', { class: 'name', attrs: { title: item.name } }, item.name),
          item.shortcut
            ? h('span', { class: 'kbd', attrs: { 'aria-hidden': 'true' } }, item.shortcut)
            : null,
        ),
      );
    });
    this.node.replaceChildren(...rows);
  }

  private buttons(): HTMLButtonElement[] {
    return [...this.node.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')];
  }

  private key(event: KeyboardEvent): void {
    const buttons = this.buttons();
    const current = buttons.findIndex((button) => button === event.target);
    const focus = (index: number) => {
      event.preventDefault();
      buttons[(index + buttons.length) % buttons.length]?.focus({ preventScroll: true });
    };
    switch (event.key) {
      case 'ArrowDown':
        return focus(current + 1);
      case 'ArrowUp':
        return focus(current < 0 ? buttons.length - 1 : current - 1);
      case 'Home':
        return focus(0);
      case 'End':
        return focus(buttons.length - 1);
      case 'Escape':
        event.preventDefault();
        return this.events.close(true);
      case 'Tab':
        return this.events.close(false);
    }
  }
}
