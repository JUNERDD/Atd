import type { OwnInput, RunView } from '../../channel/payloads.ts';
import type { ContentMessage } from '../../messages/content.ts';
import type { SurfaceRun, TabView } from '../../messages/views.ts';
import { AskFlow } from '../ask/flow.ts';
import { copyText } from '../clipboard.ts';
import { t } from '../i18n.ts';
import { answerableRequest, cardIdentity } from './card.ts';
import type { HudIntent, RunRender } from './intents.ts';
import { RunOverlays, STOP_SPINNER_MS, isTerminal, overlayDeadlines } from './local.ts';
import { HOME, loadAnchor } from './position.ts';
import { runNode, startingRow } from './states.ts';
import { type HudContent, HudView, restingBounds } from './view.ts';
import { signal } from '../lifetime.ts';

/** What the tab's light does for the HUD's state (`edge-light.ts`). */
export type GlowMode = 'off' | 'working' | 'attention' | 'frozen' | 'done' | 'keep';

/** An ended run without a reply leaves on its own after this, unless the person is on the HUD. */
const AUTO_HIDE_MS = 12_000;
const COPIED_MS = 1500;

export interface HudDeps {
  send(message: ContentMessage): void;
  takeOwnInput(): OwnInput | undefined;
  /** The HUD's state or place changed: the light follows. */
  changed(): void;
}

/**
 * The in-tab HUD for the run that owns this tab, and the in-page ask (spec 8, 9; D10). The shell's
 * `RunView` is the truth; this adds only what the tab does locally (`RunOverlays`) and the ask in
 * progress. A stale answer simply re-renders from the next state: the first answer given anywhere
 * wins. Its view, and the place the person left it on this site, wait for the first content to
 * show: a page where the HUD never shows builds and reads neither.
 */
export class Hud {
  readonly ask: AskFlow;
  private readonly overlays = new RunOverlays();
  private tab: TabView | null = null;
  private renderTimers: number[] = [];
  private autoHide: { runId: string; timer: number } | null = null;
  private last: HudContent | null = null;
  private built: HudView | null = null;
  private anchor: 'unread' | 'reading' | 'read' = 'unread';

  constructor(private readonly deps: HudDeps) {
    this.ask = new AskFlow({
      send: (message) => deps.send(message),
      takeOwnInput: () => deps.takeOwnInput(),
      changed: () => this.render(),
    });
    // A click elsewhere closes the composer and keeps its draft; one that picks an element of the
    // page (the inspector) is the composer's own.
    addEventListener(
      'pointerdown',
      (event) => {
        if (this.ask.phase !== 'compose' || this.ask.capturing || this.view.contains(event)) return;
        this.ask.close(false);
      },
      { capture: true, signal },
    );
  }

  /** The capsule's box (where it would show while it does not), for the light and transitions. */
  bounds(): DOMRectReadOnly {
    return this.built?.bounds() ?? restingBounds(HOME);
  }

  /** Everything the HUD draws right now (`HudView.drawnBounds`); null while nothing shows. */
  drawnBounds(): DOMRectReadOnly | null {
    return this.built?.drawnBounds() ?? null;
  }

  /** Whether `event` is the HUD's ⌃⌥⌘ + arrow move shortcut while it shows. */
  isMoveShortcut(event: Event): boolean {
    return this.built?.isMoveShortcut(event) ?? false;
  }

  update(tab: TabView): void {
    this.tab = tab;
    this.built?.setEffects(tab.prefs.glowEffects);
    this.ask.update(tab);
    this.render();
  }

  /** `ask.open` from the background (the toolbar button, the ask shortcut). */
  openAsk(): void {
    this.ask.open();
  }

  /** `followUp.failed`: Save as automation did not reach Atd; the HUD says so and allows a retry. */
  followUpFailed(taskId: string): void {
    if (this.overlays.failedFollowUp(taskId)) this.render();
  }

  /** The language changed: everything built from copy is built again. */
  relabel(): void {
    this.ask.relabel();
    this.render(true);
  }

  /** What the light shows for the current state. */
  glowMode(): GlowMode {
    if (this.ask.phase === 'starting') return 'working';
    const run = this.tab?.run;
    if (!run) return 'off';
    switch (this.overlays.status(run, Date.now())) {
      case 'working':
        return 'working';
      case 'attention':
        return 'attention';
      case 'stopping':
        return 'keep';
      case 'disconnected':
        return 'frozen';
      case 'done':
        return 'done';
      case 'held':
      case 'stopped':
      case 'failed':
        return 'off';
    }
  }

  /** The layer and capsule, built the first time the HUD has something to show. */
  private get view(): HudView {
    if (!this.built) {
      this.built = new HudView(() => this.deps.changed());
      if (this.tab) this.built.setEffects(this.tab.prefs.glowEffects);
    }
    return this.built;
  }

  /** `relabel` forces a rebuild; otherwise unchanged content is left alone (with its focus). */
  private render(rebuild = false): void {
    for (const timer of this.renderTimers) clearTimeout(timer);
    this.renderTimers = [];
    if (rebuild) this.last = null;
    this.last = this.content();
    if (this.last || this.built) {
      // The first content waits for the HUD's remembered place: it shows there from the start,
      // and the light that follows it starts with it.
      if (!this.placed()) return;
      this.view.show(this.last, rebuild);
    }
    this.deps.changed();
  }

  /** Whether the HUD's place on this site is known; the first call reads it, then renders again. */
  private placed(): boolean {
    if (this.anchor === 'read') return true;
    if (this.anchor === 'unread') {
      this.anchor = 'reading';
      void loadAnchor().then((anchor) => {
        this.anchor = 'read';
        this.view.mover.place(anchor);
        this.render();
        // `AskFlow.open` focused the field before it was in the page.
        if (this.ask.phase === 'compose') this.ask.composer.focus();
      });
    }
    return false;
  }

  private content(): HudContent | null {
    // The composer shows from the first press, before the tab's first view arrives.
    if (this.ask.composing) {
      return this.reuse('compose', () => ({
        node: this.ask.composer.node,
        shape: 'compose',
        scene: 'compose',
        role: 'dialog',
        label: t('hud.label', { title: t('ask.label') }),
        guarded: null,
      }));
    }
    const tab = this.tab;
    if (!tab) return null;
    if (this.ask.phase === 'starting') {
      const text = this.ask.startingText;
      return this.reuse(`starting:${text}:${tab.prefs.glowEffects}`, () => ({
        node: startingRow(text, tab.prefs.glowEffects),
        shape: 'row',
        // The run it starts takes over the same row in place, as its working row.
        scene: 'row:working',
        role: 'status',
        label: t('hud.label', { title: text }),
        guarded: null,
      }));
    }
    const run = tab.run;
    if (!run || this.overlays.isDismissed(run)) return null;
    const guarded = this.guardedCard(run);
    const ctx = this.renderContext(run, tab, guarded);
    this.scheduleFor(run, ctx);
    const { status, reachable, ready, effects, late, followUp, answering, covered, copied } = ctx;
    const key = JSON.stringify([
      run,
      status,
      reachable,
      ready,
      effects,
      late,
      followUp,
      answering,
      covered,
      copied,
    ]);
    return this.reuse(key, () => ({
      ...runNode(ctx),
      role: 'status',
      label: t('hud.label', { title: run.title }),
      guarded,
    }));
  }

  /** The card whose answers the click guard protects, while the run shows one. */
  private guardedCard(run: RunView): string | null {
    if (this.overlays.status(run, Date.now()) !== 'attention') return null;
    const request = answerableRequest(run);
    return request ? cardIdentity(request) : null;
  }

  /** The content shown last when its key is unchanged, else a new one from `build`. */
  private reuse(key: string, build: () => Omit<HudContent, 'key'>): HudContent {
    if (this.last?.key === key) return this.last;
    return { ...build(), key };
  }

  private renderContext(run: SurfaceRun, tab: TabView, guarded: string | null): RunRender {
    const now = Date.now();
    const status = this.overlays.status(run, now);
    return {
      run,
      status,
      reachable: tab.connection === 'ready' || tab.connection === 'serviceUnavailable',
      ready: tab.connection === 'ready',
      effects: tab.prefs.glowEffects,
      late: status === 'stopping' && now - this.overlays.stoppingSince(run, now) >= STOP_SPINNER_MS,
      followUp: this.overlays.followUp(run),
      answering: this.overlays.isAnswering(run, now),
      covered: this.overlays.isCovered(guarded),
      copied: this.overlays.wasCopied(run),
      intent: (intent) => this.act(run, intent),
    };
  }

  /** Timers the shown state implies: the spinner, overlay expiry, and an ended run's auto-hide. */
  private scheduleFor(run: RunView, ctx: RunRender): void {
    const now = Date.now();
    for (const deadline of overlayDeadlines(run, this.overlays, now)) {
      this.renderTimers.push(window.setTimeout(() => this.render(), deadline - now + 16));
    }
    // A failure stays until dismissed; so does a reply the person may still be reading.
    const hides =
      ctx.status === 'stopped' || (ctx.status === 'done' && !(run.fromExtension && run.result));
    if (!hides) {
      if (this.autoHide) clearTimeout(this.autoHide.timer);
      this.autoHide = null;
    } else if (this.autoHide?.runId !== run.runId) {
      this.armAutoHide(run, AUTO_HIDE_MS);
    }
  }

  private armAutoHide(run: RunView, delay: number): void {
    if (this.autoHide) clearTimeout(this.autoHide.timer);
    const timer = window.setTimeout(() => {
      const capsule = this.view.capsule;
      // Never pull the HUD away from under the person's pointer or focus.
      if (capsule.matches(':hover') || this.view.layer.activeElement) {
        return this.armAutoHide(run, 4000);
      }
      this.overlays.dismiss(run);
      // The background keeps it hidden in this tab, so a reload does not bring it back.
      this.deps.send({ type: 'run.hide', taskId: run.taskId, runId: run.runId });
      this.render();
    }, delay);
    this.autoHide = { runId: run.runId, timer };
  }

  private act(run: RunView, intent: HudIntent): void {
    const { taskId, runId } = run;
    const send = (message: ContentMessage) => this.deps.send(message);
    switch (intent.kind) {
      case 'takeOver':
        return send({ type: 'run.hold', taskId, runId, held: true });
      case 'handBack': {
        const ownInput = this.deps.takeOwnInput();
        return send({
          type: 'run.hold',
          taskId,
          runId,
          held: false,
          ...(ownInput === undefined ? {} : { ownInput }),
        });
      }
      case 'stop':
        this.overlays.stop(run, Date.now());
        send({ type: 'run.stop', taskId, runId });
        return this.render();
      case 'open':
        return send({ type: 'app.open', taskId });
      case 'saveAutomation':
        this.overlays.sentFollowUp(run);
        send({ type: 'run.followUp', taskId, kind: 'saveAutomation' });
        return this.render();
      case 'dismiss':
        this.overlays.dismiss(run);
        // The shell may forget an ended run once the person has dismissed it here, and the
        // background keeps it out of this tab.
        if (isTerminal(run.status)) send({ type: 'run.dismiss', taskId, runId });
        return this.render();
      case 'copy':
        void copyText(intent.text, this.view.layer.root).then((copied) => {
          if (!copied) return;
          this.overlays.copied(run);
          this.render();
          window.setTimeout(() => {
            this.overlays.copied(null);
            this.render();
          }, COPIED_MS);
        });
        return;
      case 'answer': {
        const { requestId, revision } = intent.request;
        // Only a card the person can really see, and that has stayed put, takes an answer; until
        // it has, its answers look inactive (`data-settling`) and a click on them does nothing.
        const verdict = this.view.guard.verdict();
        if (verdict !== 'allowed') {
          if (verdict === 'covered') this.overlays.cover(cardIdentity(intent.request));
          return this.render();
        }
        this.overlays.cover(null);
        this.overlays.answering(requestId, revision, Date.now());
        const ownInput = this.deps.takeOwnInput();
        const declined = 'decision' in intent.answer && intent.answer.decision === 'declined';
        send({
          type: 'request.answer',
          taskId,
          requestId,
          revision,
          answer: intent.answer,
          ...(!declined && ownInput !== undefined ? { ownInput } : {}),
        });
        return this.render();
      }
    }
  }
}
