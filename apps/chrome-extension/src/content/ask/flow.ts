import type { BackgroundToContent, ContentMessage } from '../../messages/content.ts';
import { ACTIVE_RUN_STATUSES, type AskFailure, type TabView } from '../../messages/views.ts';
import { t } from '../i18n.ts';
import { Composer } from './composer.ts';
import { requestId } from '../ids.ts';

/**
 * `compose`: the field is open. `sending`: the request is on its way. `starting`: Atd took it and
 * the HUD keeps a working look until the run shows for this tab.
 */
export type AskPhase = 'closed' | 'compose' | 'sending' | 'starting';

/** How long the starting look waits for the run before it gives up quietly. */
const STARTING_LIMIT_MS = 20_000;

export interface AskDeps {
  send(message: ContentMessage): void;
  /** The phase or the composer's content changed; the HUD renders again. */
  changed(): void;
}

/** Why Atd did not take the request, in the person's words: never the code itself. */
function failureCopy(reason: AskFailure | undefined): string {
  switch (reason) {
    case 'notConnected':
      return t('ask.failure.notConnected');
    case 'notPaired':
      return t('ask.failure.notPaired');
    case 'tooLong':
      return t('ask.failure.tooLong');
    case 'otherHost':
      return t('ask.failure.otherHost');
    case 'serviceUnavailable':
      return t('ask.failure.serviceUnavailable');
    case 'failed':
    case undefined:
    default:
      // A code this version does not know reads as the generic failure too.
      return t('ask.failure.failed');
  }
}

/** Atd takes one request per browser at a time, and only while connected and paired. */
export function canAsk(view: TabView | null): boolean {
  return view !== null && view.paired && view.connection === 'ready' && !view.busy;
}

/**
 * The in-page ask (the ask shortcut, ⇧⌘K by default, or the popup's "Ask Atd on This Page…"): a
 * content-script surface that reads nothing and sends nothing until the person sends. Closing it
 * (Esc, or a click elsewhere) keeps the draft for this tab; Esc hands focus back to where the
 * person was. A failed request reopens the field with its reason and the draft intact.
 */
export class AskFlow {
  phase: AskPhase = 'closed';
  readonly composer: Composer;
  /** The request's text, shown in the starting row. */
  startingText = '';
  private requestId: string | null = null;
  private runAtSend: string | null = null;
  /** The run Atd said it started for the request; null until accepted (or when not named). */
  private startedRun: string | null = null;
  private returnFocus: HTMLElement | null = null;
  private startingTimer = 0;
  private view: TabView | null = null;

  constructor(private readonly deps: AskDeps) {
    this.composer = new Composer({
      submit: () => this.submit(),
      escape: () => this.close(true),
      changed: () => deps.changed(),
    });
  }

  get composing(): boolean {
    return this.phase === 'compose' || this.phase === 'sending';
  }

  /** `ask.open`: opens the field; a second press closes it. */
  open(): void {
    if (this.composing) return this.close(true);
    if (!canAsk(this.view) || this.phase === 'starting') return;
    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    this.phase = 'compose';
    this.composer.prepare(this.host());
    this.composer.setState(false, true);
    this.deps.changed();
    this.composer.focus();
  }

  /** `restore` is false when a click elsewhere closed it: focus stays where the person clicked. */
  close(restore: boolean): void {
    if (this.phase !== 'compose') return;
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
      if (!view.paired) return this.close(false);
      this.composer.setState(false, canAsk(view));
    }
  }

  private submit(): void {
    if (this.phase !== 'compose' || !this.composer.canSend || !canAsk(this.view)) return;
    const text = this.composer.text;
    this.requestId = requestId();
    this.runAtSend = this.view?.run?.runId ?? null;
    this.startedRun = null;
    this.startingText = text;
    this.phase = 'sending';
    this.composer.setError(null);
    this.composer.setState(true, true);
    this.deps.send({
      type: 'ask',
      requestId: this.requestId,
      text,
      includePage: this.composer.includePage,
    });
    this.deps.changed();
  }

  private fail(message: string): void {
    this.phase = 'compose';
    this.composer.setState(false, canAsk(this.view));
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
