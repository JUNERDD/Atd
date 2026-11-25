import type { RunView } from '../../channel/payloads.ts';
import type { ContentMessage } from '../../messages/content.ts';
import type { TabView } from '../../messages/views.ts';
import { AskFlow } from '../ask/flow.ts';
import { copyText } from '../clipboard.ts';
import { t } from '../i18n.ts';
import { answerableRequest, cardIdentity } from './card.ts';
import type { HudIntent, RunRender } from './intents.ts';
import { RunOverlays, STOP_SPINNER_MS, isTerminal, overlayDeadlines } from './local.ts';
import { loadAnchor } from './position.ts';
import { runNode, startingRow } from './states.ts';
import { type HudContent, HudView } from './view.ts';
import { signal } from '../lifetime.ts';

/** What the tab's light does for the HUD's state (`edge-light.ts`). */
export type GlowMode = 'off' | 'working' | 'attention' | 'frozen' | 'done' | 'keep';

/** An ended run without a reply leaves on its own after this, unless the person is on the HUD. */
const AUTO_HIDE_MS = 12_000;
const COPIED_MS = 1500;

export interface HudDeps {
  send(message: ContentMessage): void;
  /** The HUD's state or place changed: the light follows. */
  changed(): void;
}

/**
 * The in-tab HUD for the run that owns this tab, and the in-page ask (spec 8, 9; D10). The shell's
 * `RunView` is the truth; this adds only what the tab does locally (`RunOverlays`) and the ask in
 * progress. A stale answer simply re-renders from the next state: the first answer given anywhere
 * wins.
 */
export class Hud {
  readonly view: HudView;
  readonly ask: AskFlow;
  private readonly overlays = new RunOverlays();
  private tab: TabView | null = null;
  private renderTimers: number[] = [];
  private autoHide: { runId: string; timer: number } | null = null;
  private last: HudContent | null = null;

  constructor(private readonly deps: HudDeps) {
    this.view = new HudView(() => deps.changed());
    this.ask = new AskFlow({ send: (message) => deps.send(message), changed: () => this.render() });
    void loadAnchor().then((anchor) => this.view.mover.place(anchor));
    // A click elsewhere closes the composer and keeps its draft.
    addEventListener(
      'pointerdown',
      (event) => {
        if (this.ask.phase === 'compose' && !this.view.contains(event)) this.ask.close(false);
      },
      { capture: true, signal },
    );
  }

  update(tab: TabView): void {
    this.tab = tab;
    this.view.setEffects(tab.prefs.glowEffects);
    this.ask.update(tab);
    this.render();
  }

  /** `ask.open` from the background. */
  openAsk(quote: string | null): void {
    this.ask.open(quote);
  }

  /** `followUp.failed`: Save as automation did not reach Atd; the HUD says so and allows a retry. */
  followUpFailed(taskId: string): void {
    if (this.overlays.failedFollowUp(taskId)) this.render();
  }

  /** The language changed: everything built from copy is built again. */
  relabel(): void {
    this.ask.composer.relabel();
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

  /** `relabel` forces a rebuild; otherwise unchanged content is left alone (with its focus). */
  private render(rebuild = false): void {
    for (const timer of this.renderTimers) clearTimeout(timer);
    this.renderTimers = [];
    if (rebuild) this.last = null;
    this.last = this.content();
    this.view.show(this.last, rebuild);
    this.deps.changed();
  }

  private content(): HudContent | null {
    const tab = this.tab;
    if (!tab) return null;
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

  private renderContext(run: RunView, tab: TabView, guarded: string | null): RunRender {
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
      case 'handBack':
        return send({ type: 'run.hold', taskId, runId, held: false });
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
        send({ type: 'request.answer', taskId, requestId, revision, answer: intent.answer });
        return this.render();
      }
    }
  }
}
