import type { OwnInput } from '../../channel/payloads.ts';
import type { BackgroundToContent, ContentMessage } from '../../messages/content.ts';
import { ACTIVE_RUN_STATUSES, type TabView } from '../../messages/views.ts';
import { t } from '../i18n.ts';
import { requestId } from '../ids.ts';
import { Inspector } from '../inspector/inspector.ts';
import { Composer } from './composer.ts';
import { blockedCopy, canAsk, failureCopy } from './status.ts';

/**
 * `compose`: the field is open. `sending`: the request is on its way. `starting`: Atd took it and
 * the HUD keeps a working look until the run shows for this tab.
 */
export type AskPhase = 'closed' | 'compose' | 'sending' | 'starting';

/** How long the starting look waits for the run before it gives up quietly. */
const STARTING_LIMIT_MS = 20_000;

export interface AskDeps {
  send(message: ContentMessage): void;
  takeOwnInput(): OwnInput | undefined;
  /** The phase or the composer's content changed; the HUD renders again. */
  changed(): void;
}

/**
 * The in-page ask (the toolbar button, or the ask shortcut ⇧⌘K by default): a content-script
 * surface that reads nothing and sends nothing until the person acts. It opens in every connection
 * state; while Atd cannot take a request it says why, with send disabled, and offers Atd's panel.
 * Its inspector picks elements of the page to send with the request, reading each only as it is
 * picked. Closing it (Esc, or a click elsewhere) keeps the draft, picked elements included, for
 * this tab; Esc hands focus back to where the person was. A failed request reopens the field with
 * its reason and the draft intact.
 */
export class AskFlow {
  phase: AskPhase = 'closed';
  /** The request's text, shown in the starting row. */
  startingText = '';
  private requestId: string | null = null;
  private runAtSend: string | null = null;
  /** The run Atd said it started for the request; null until accepted (or when not named). */
  private startedRun: string | null = null;
  private returnFocus: HTMLElement | null = null;
  private startingTimer = 0;
  private view: TabView | null = null;
  /** Built the first time the ask opens: a page where nobody asks never builds it. */
  private built: Composer | null = null;
  /** Created the first time the person picks or a chip marks its element. */
  private inspector: Inspector | null = null;

  constructor(private readonly deps: AskDeps) {}

  get composer(): Composer {
    this.built ??= new Composer({
      submit: () => this.submit(),
      escape: () => this.close(true),
      changed: () => this.deps.changed(),
      inspect: () => this.inspect(),
      openPanel: () => this.openPanel(),
      highlight: (element) => this.highlight(element),
    });
    return this.built;
  }

  get composing(): boolean {
    return this.phase === 'compose' || this.phase === 'sending';
  }

  /**
   * Whether the page's pointer events are Atd's own right now: the inspector is picking, or has
   * just picked. A click elsewhere then neither closes the ask nor counts as the page's input.
   */
  get capturing(): boolean {
    return this.inspector?.capturing === true;
  }

  /**
   * `ask.open`: opens the field, whatever the connection; a second press closes it. While Atd is
   * starting the request just sent, the HUD's starting row stays.
   */
  open(): void {
    if (this.composing) return this.close(true);
    if (this.phase === 'starting') return;
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    this.phase = 'compose';
    this.composer.prepare(this.host());
    this.sync();
    this.deps.changed();
    this.composer.focus();
  }

  /** The language changed: the composer's copy follows (once it exists). */
  relabel(): void {
    this.built?.relabel();
  }

  /** `restore` is false when a click elsewhere closed it: focus stays where the person clicked. */
  close(restore: boolean): void {
    if (this.phase !== 'compose') return;
    this.stopPicking();
    this.phase = 'closed';
    this.composer.setError(null);
    this.deps.changed();
    if (restore && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  /** Atd's answer to the request: it took it (naming the run it started), or why not. */
  status(message: Extract<BackgroundToContent, { type: 'ask.status' }>): void {
    if (message.requestId !== this.requestId || this.phase !== 'sending') return;
    this.requestId = null;
    if (message.state === 'failed') {
      this.fail(failureCopy(message.reason));
      return;
    }
    this.startedRun = message.runId ?? null;
    this.phase = 'starting';
    this.composer.reset();
    this.composer.setState(false, true);
    clearTimeout(this.startingTimer);
    this.startingTimer = window.setTimeout(() => this.started(), STARTING_LIMIT_MS);
    this.deps.changed();
  }

  /** `panel.status`: Atd's panel opened, so the ask steps aside (keeping its draft); or it did not. */
  panelStatus(opened: boolean): void {
    if (this.phase !== 'compose') return;
    if (opened) this.close(false);
    else this.composer.setError(t('ask.panelFailed'));
  }

  /** Follows the tab: a lost channel fails a request on its way; the new run ends `starting`. */
  update(view: TabView): void {
    this.view = view;
    if (this.phase === 'sending' && view.connection !== 'ready') {
      this.requestId = null;
      this.fail(t('ask.lost'));
    } else if (this.phase === 'starting' && view.run && view.run.runId !== this.runAtSend) {
      // The run Atd named ends the starting look; without a name, the first new run here does.
      if (this.startedRun !== null) {
        if (view.run.runId === this.startedRun) this.started();
      } else if (ACTIVE_RUN_STATUSES.includes(view.run.status) || view.run.fromExtension) {
        this.started();
      }
    } else if (this.phase === 'compose') {
      this.sync();
    }
  }

  /** The send button and the status row follow what Atd can take now. */
  private sync(): void {
    this.composer.setState(false, canAsk(this.view));
    this.composer.setBlocked(blockedCopy(this.view), this.view?.panel ?? null);
  }

  private submit(): void {
    if (this.phase !== 'compose' || !this.composer.canSend || !canAsk(this.view)) return;
    this.stopPicking();
    const text = this.composer.text;
    const { includePage } = this.composer.context;
    const elements = this.composer.context.elements();
    this.requestId = requestId();
    this.runAtSend = this.view?.run?.runId ?? null;
    this.startedRun = null;
    this.startingText = text;
    this.phase = 'sending';
    this.composer.setError(null);
    this.composer.setState(true, true);
    const ownInput = this.deps.takeOwnInput();
    this.deps.send({
      type: 'ask',
      requestId: this.requestId,
      text,
      includePage,
      ...(elements.length > 0 ? { elements } : {}),
      ...(ownInput === undefined ? {} : { ownInput }),
    });
    this.deps.changed();
  }

  /** The inspector control: starts picking an element of the page, or stops. */
  private inspect(): void {
    if (this.phase !== 'compose') return;
    const inspector = (this.inspector ??= new Inspector());
    if (inspector.picking) return this.stopPicking();
    if (this.composer.context.full) return;
    this.composer.setError(null);
    this.composer.setPicking(true);
    inspector.pick({
      picked: (element, picked) => {
        if (picked === null) this.composer.setError(t('ask.pickFailed'));
        else this.composer.context.add(element, picked);
        this.composer.setPicking(false);
        this.composer.focus();
      },
      canceled: () => {
        this.composer.setPicking(false);
        this.composer.focus();
      },
    });
  }

  private stopPicking(): void {
    this.inspector?.stop();
    this.composer.setPicking(false);
  }

  private highlight(element: Element | null): void {
    if (element === null) this.inspector?.show(null);
    else (this.inspector ??= new Inspector()).show(element);
  }

  /** Open side panel: the background opens it within this click and answers `panel.status`. */
  private openPanel(): void {
    this.stopPicking();
    this.deps.send({ type: 'panel.open' });
  }

  private fail(message: string): void {
    this.phase = 'compose';
    this.sync();
    this.composer.setError(message);
    this.deps.changed();
    this.composer.focus();
  }

  private started(): void {
    clearTimeout(this.startingTimer);
    if (this.phase !== 'starting') return;
    this.phase = 'closed';
    this.deps.changed();
  }

  private host(): string {
    return this.view?.site?.host ?? location.hostname;
  }
}
