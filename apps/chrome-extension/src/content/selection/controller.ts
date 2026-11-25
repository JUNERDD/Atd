import { ChevronDown, Languages, createElement } from 'lucide';
import type { CommandItem, CommandRef } from '../../channel/payloads.ts';
import type { BackgroundToContent, ContentMessage } from '../../messages/content.ts';
import type { TabView } from '../../messages/views.ts';
import { focusedAct, gbtn, h, iconAttrs, refocus } from '../dom.ts';
import { Layer, fromOwnLayer, sheet } from '../hosts.ts';
import { t } from '../i18n.ts';
import { atdMark } from '../mark.ts';
import { type CapturedSelection, captureSelection } from './capture.ts';
import { CommandMenu } from './menu.ts';
import { ResultCard } from './result.ts';
import selectionCss from './selection.css?inline';
import { signal } from '../lifetime.ts';
import { requestId } from '../ids.ts';
import { watchSelections } from './watch.ts';

export interface SelectionDeps {
  send(message: ContentMessage): void;
  /** Ask Atd: the in-page ask opens with the selection as its quote. */
  ask(quote: string): void;
  copy(text: string, scratch: HTMLElement): Promise<boolean>;
}

type CommandStatus = Extract<BackgroundToContent, { type: 'command.status' }>;

/**
 * Commands on selected text (spec 11, D12): once a selection the person made settles (with the
 * mouse or the keyboard, `watch.ts`), and only while paired and connected, a bar offers Ask Atd,
 * Summarize, Translate and the person's own commands; the result shows in place. The bar goes on
 * Esc, a scroll, a collapsed selection or a click elsewhere, and presses on it keep the page's
 * selection. The layer is in the page only while the bar, its menu or a result shows.
 */
export class SelectionCommands {
  private readonly layer: Layer;
  private readonly bar: HTMLDivElement;
  private readonly menu: CommandMenu;
  private readonly result: ResultCard;
  private view: TabView | null = null;
  private captured: CapturedSelection | null = null;
  private pending: { requestId: string; taskId: string | null } | null = null;

  constructor(private readonly deps: SelectionDeps) {
    this.layer = new Layer('atd-selection', [sheet(selectionCss)]);
    this.bar = h('div', {
      class: 'sel-bar glass',
      attrs: { role: 'toolbar', hidden: true },
      on: { mousedown: (event) => event.preventDefault() },
    });
    this.menu = new CommandMenu({
      pick: (command) => this.run({ kind: 'user', commandId: command.id }, command.name),
      close: (restore) => this.closeMenu(restore),
    });
    this.menu.node.addEventListener('mousedown', (event) => event.preventDefault());
    this.result = new ResultCard(
      {
        copy: (text) => {
          void deps.copy(text, this.layer.root).then((copied) => {
            if (copied) this.result.markCopied();
          });
        },
        continueInAtd: () => {
          const taskId = this.pending?.taskId;
          deps.send({ type: 'app.open', ...(taskId ? { taskId } : {}) });
        },
        dismiss: () => this.closeResult(),
      },
      () => this.view?.prefs.glowEffects ?? true,
    );
    this.layer.root.append(this.bar, this.menu.node, this.result.node);
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      this.layer.root.addEventListener(type, (event) => event.stopPropagation());
    }
    this.listen();
  }

  update(view: TabView): void {
    this.view = view;
    if (!this.available()) return this.hideAll();
    this.menu.update(view.commands);
    if (!this.bar.hidden) this.renderBar();
  }

  status(message: CommandStatus): void {
    const pending = this.pending;
    if (!pending || message.requestId !== pending.requestId) return;
    if (message.taskId) pending.taskId = message.taskId;
    switch (message.state) {
      case 'working':
        return this.result.set({ state: 'working' });
      case 'done':
        return this.result.set({ state: 'done', text: message.text ?? '' });
      case 'failed':
        return this.result.set({ state: 'failed', message: message.text ?? t('selection.failed') });
    }
  }

  relabel(): void {
    if (!this.bar.hidden) this.renderBar();
    this.result.relabel();
  }

  /** The in-page ask opened over the page: the bar steps aside. */
  hideBar(): void {
    this.bar.hidden = true;
    this.menu.close();
    this.captured = null;
    this.syncLayer();
  }

  private available(): boolean {
    const view = this.view;
    return view !== null && view.paired && view.connection === 'ready';
  }

  /** The layer is in the page while anything of it shows. */
  private syncLayer(): void {
    if (!this.bar.hidden || this.menu.isOpen || this.result.isOpen) this.layer.mount();
    else this.layer.unmount();
  }

  private listen(): void {
    watchSelections({
      settled: () => {
        const captured = this.available() ? captureSelection() : null;
        if (!captured) return this.hideBar();
        if (!this.bar.hidden && sameSelection(captured, this.captured)) return;
        this.showBar(captured);
      },
      changed: () => {
        if (!this.bar.hidden && !captureSelection()) this.hideBar();
      },
    });
    addEventListener('scroll', () => this.hideBar(), { capture: true, passive: true, signal });
    addEventListener(
      'pointerdown',
      (event) => {
        if (fromOwnLayer(event)) return;
        this.hideBar();
        this.closeResult();
      },
      { capture: true, signal },
    );
    addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || (this.bar.hidden && !this.result.isOpen)) return;
        this.hideBar();
        this.closeResult();
      },
      { signal },
    );
  }

  private showBar(captured: CapturedSelection): void {
    const opening = this.bar.hidden;
    this.captured = captured;
    this.menu.close();
    this.bar.hidden = false;
    this.layer.mount();
    this.renderBar();
    const width = this.bar.offsetWidth;
    const height = this.bar.offsetHeight;
    const rect = captured.rect;
    const x = Math.max(
      12,
      Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 12),
    );
    const above = rect.top - height - 8;
    const y = above >= 8 ? above : Math.min(rect.bottom + 8, innerHeight - height - 8);
    this.bar.style.setProperty('left', `${x}px`);
    this.bar.style.setProperty('top', `${y}px`);
    if (opening) this.deps.send({ type: 'commands.refresh' });
  }

  private renderBar(): void {
    const busy = this.view?.busy ?? true;
    const more = gbtn({
      act: 'more',
      variant: 'icon',
      label: t('selection.more'),
      icon: createElement(ChevronDown, iconAttrs(14)),
      onClick: () => this.toggleMenu(),
    });
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', String(this.menu.isOpen));
    more.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      this.toggleMenu();
    });
    this.bar.setAttribute('aria-label', t('selection.toolbar'));
    const focused = focusedAct(this.layer.activeElement);
    this.bar.replaceChildren(
      gbtn({
        act: 'ask',
        label: t('selection.askAtd'),
        icon: atdMark(14),
        disabled: busy,
        onClick: () => {
          const quote = this.captured?.text;
          this.hideBar();
          if (quote) this.deps.ask(quote);
        },
      }),
      h('span', { class: 'hud-div' }),
      gbtn({
        act: 'summarize',
        label: t('selection.summarize'),
        onClick: () => this.run({ kind: 'builtin', id: 'summarize' }, t('selection.summarize')),
      }),
      gbtn({
        act: 'translate',
        label: t('selection.translate'),
        icon: createElement(Languages, iconAttrs(14)),
        onClick: () => this.run({ kind: 'builtin', id: 'translate' }, t('selection.translate')),
      }),
      more,
    );
    refocus(this.bar, focused);
  }

  /** The menu takes focus on its first command, from a click or from ↓ on its button. */
  private toggleMenu(): void {
    if (this.menu.isOpen) return this.closeMenu(true);
    const bar = this.bar.getBoundingClientRect();
    const commands: readonly CommandItem[] = this.view?.commands ?? [];
    this.menu.open(commands, bar.right - 240, bar.bottom + 6, true);
    this.bar.querySelector('[data-act="more"]')?.setAttribute('aria-expanded', 'true');
  }

  private closeMenu(restoreFocus: boolean): void {
    this.menu.close();
    const more = this.bar.querySelector<HTMLButtonElement>('[data-act="more"]');
    more?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) more?.focus({ preventScroll: true });
  }

  private run(command: CommandRef, title: string): void {
    const captured = this.captured;
    if (!captured || !this.available()) return;
    const id = requestId();
    this.pending = { requestId: id, taskId: null };
    this.layer.mount();
    this.result.open(title, captured.rect);
    this.hideBar();
    this.deps.send({ type: 'command.run', requestId: id, selection: captured.text, command });
  }

  private closeResult(): void {
    if (!this.result.isOpen) return;
    this.result.close();
    this.pending = null;
    this.syncLayer();
  }

  private hideAll(): void {
    this.hideBar();
    this.closeResult();
  }
}

/** The same text at the same place: a settled selection the bar already offers. */
function sameSelection(a: CapturedSelection, b: CapturedSelection | null): boolean {
  return (
    b !== null && a.text === b.text && a.rect.top === b.rect.top && a.rect.left === b.rect.left
  );
}
