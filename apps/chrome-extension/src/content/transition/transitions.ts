import type { ContentMessage } from '../../messages/content.ts';
import { h } from '../dom.ts';
import { Layer, sheet } from '../hosts.ts';
import { requestId } from '../ids.ts';
import { signal } from '../lifetime.ts';
import { CaptureClient, type FrameReply } from './capture.ts';
import {
  DURATION_MS,
  frameSetup,
  maskRects,
  unionRects,
  type FrameSetup,
  type TransitionKind,
  type ViewportPoint,
} from './frame.ts';
import { TransitionSurface } from './surface.ts';
import transitionCss from './transition.css?inline';

export type { TransitionKind, ViewportPoint } from './frame.ts';
export type { FrameReply } from './capture.ts';

const FADE_IN_MS = 90;
const FADE_OUT_MS = 180;

export interface TransitionOptions {
  /** The HUD's centre in viewport CSS px, read once as the transition starts. */
  origin(): ViewportPoint;
  /** How dark the page is (`pageDarkness`): 0 light … 1 dark. */
  darkness: number;
  /**
   * Atd's own surfaces in the tab (the HUD, the pointer: at most four, same order every call), in
   * viewport CSS px; an empty rect stands for one not shown. Read when the capture is requested,
   * when it arrives, and on every frame.
   */
  masks(): readonly DOMRectReadOnly[];
  /**
   * Called once the frozen frame covers the page (its fade-in has ended), so what it froze may
   * leave the live page under it at once. Never called for a play that draws nothing.
   */
  covered?(): void;
}

export interface TransitionDeps {
  /** The content port's `send`. */
  send(message: ContentMessage): void;
}

/** The canvas and its GPU context, from a play's start until its fade has ended. */
interface Stage {
  canvas: HTMLCanvasElement;
  surface: TransitionSurface;
  /** The pending teardown after a fade-out; a new play claims the stage back by clearing it. */
  timer: number;
}

/** One play, from its capture request until it has resolved. */
interface Run {
  id: string;
  kind: TransitionKind;
  /** The takeover holds the agent's screenshots and input to the tab until it ends. */
  hold: boolean;
  resolve(): void;
  settled: boolean;
  options: TransitionOptions;
  /** The HUD's centre and Atd's surfaces as the capture was requested. */
  origin: ViewportPoint;
  masked: readonly DOMRectReadOnly[];
  /** The viewport the frame must match: its width (CSS px) and device pixel ratio. */
  width: number;
  dpr: number;
  setup: FrameSetup | null;
  start: number | null;
  /** Whether `options.covered` has been called. */
  covered: boolean;
  raf: number;
}

/**
 * The page transitions (WARP.md › Snapshot transitions): a frozen frame of the tab, captured by
 * the service worker, drawn into a WebGL2 canvas over the page for one short transition, which
 * ends on the unmodified frame and fades out over the identical live page. `ripple` is the
 * takeover (1.1 s), `sweep` the done (1.35 s); both come out of the HUD's centre.
 *
 * The layer (`atd-transition`, under the light, the pointer and the HUD) and its GPU context exist
 * only while a transition plays: the context is created as `play` starts (its program compiles
 * while the tab is captured), the layer goes into the page once the frame is a texture, and both
 * go after the fade-out (`WEBGL_lose_context`). A machine where no hardware context can be had,
 * or where the program does not build, is remembered and never asked again.
 *
 * Reduce Motion and the glow effects setting are the caller's to honour. The root routes the
 * background's `transition.frame` to `receive`.
 */
export class PageTransitions {
  private readonly layer = new Layer('atd-transition', [sheet(transitionCss)]);
  private readonly capture: CaptureClient;
  private stage: Stage | null = null;
  private run: Run | null = null;
  private unavailable = false;
  private disposed = false;

  constructor(private readonly deps: TransitionDeps) {
    this.capture = new CaptureClient((message) => deps.send(message));
    this.layer.root.setAttribute('aria-hidden', 'true');
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.stop();
      },
      { signal },
    );
  }

  /**
   * Plays `kind` over a fresh capture of the tab, cancelling the one playing. Resolves once its
   * layer has left the page; at once, having drawn nothing, when the document is hidden or
   * pinch-zoomed, WebGL2 is unavailable (or only in software), the capture fails or takes over
   * 400 ms, or the frame's CSS width or device pixel ratio is not the viewport's. A width or
   * pixel ratio change while it plays ends it early, with its fade; a cancelled play resolves at
   * once.
   */
  play(kind: TransitionKind, options: TransitionOptions): Promise<void> {
    this.end();
    const stage = this.playable() ? this.claimStage() : null;
    if (!stage) {
      this.leave();
      return Promise.resolve();
    }
    stage.surface.prepare(kind);
    return new Promise<void>((resolve) => {
      const run: Run = {
        id: requestId(),
        kind,
        hold: kind === 'ripple',
        resolve,
        settled: false,
        options,
        origin: options.origin(),
        masked: options.masks(),
        width: innerWidth,
        dpr: devicePixelRatio,
        setup: null,
        start: null,
        covered: false,
        raf: 0,
      };
      this.run = run;
      void this.capture.capture(run.id, run.hold).then((frame) => {
        if (this.run !== run) frame?.close();
        else if (!frame || !this.begin(run, frame)) this.abort(run);
      });
    });
  }

  /** The background's `transition.frame`. */
  receive(reply: FrameReply): void {
    this.capture.receive(reply);
  }

  /** Ends the transition playing (its promise resolves now) and fades its frame out. */
  cancel(): void {
    this.end();
    this.leave();
  }

  /** Ends everything for good (the extension was reloaded or removed). */
  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private playable(): boolean {
    if (this.disposed || this.unavailable || document.hidden) return false;
    // A pinch-zoomed tab captures what it shows, not its layout viewport.
    return (visualViewport?.scale ?? 1) === 1;
  }

  /** Puts the frame up and starts its frames; false when it cannot play. */
  private begin(run: Run, frame: ImageBitmap): boolean {
    const stage = this.stage;
    const { options } = run;
    // A surface that moved or changed size while Chrome captured is masked where it was and is.
    const frozen = unionRects(run.masked, options.masks());
    const pixels = [frame.width, frame.height] as const;
    const setup = frameSetup(run.kind, pixels, run.dpr, run.origin, options.darkness, frozen);
    const matches =
      !document.hidden &&
      devicePixelRatio === run.dpr &&
      Math.abs(setup.size[0] - innerWidth) <= 1 &&
      Math.abs(setup.size[0] - run.width) <= 1;
    const loaded = stage !== null && matches && stage.surface.load(run.kind, frame);
    frame.close();
    if (!stage || !loaded) {
      if (stage?.surface.broken) this.unavailable = true;
      return false;
    }
    run.setup = setup;
    const { canvas } = stage;
    canvas.style.transitionDuration = '0ms';
    canvas.style.opacity = '0';
    if (canvas.parentNode !== this.layer.root) this.layer.root.replaceChildren(canvas);
    this.layer.mount();
    // Commit the hidden style, so the fade-in transitions instead of jumping.
    void canvas.offsetWidth;
    run.raf = requestAnimationFrame((now) => this.frame(run, now));
    return true;
  }

  private frame(run: Run, now: number): void {
    const stage = this.stage;
    const setup = run.setup;
    if (this.run !== run || !stage || !setup) return;
    if (run.start === null) {
      // Shown only now, on its first frame, which is the page itself.
      run.start = now;
      stage.canvas.style.transitionDuration = `${FADE_IN_MS}ms`;
      stage.canvas.style.opacity = '1';
    }
    const elapsed = now - run.start;
    if (!run.covered && elapsed >= FADE_IN_MS) {
      run.covered = true;
      run.options.covered?.();
    }
    const t = Math.min(1, elapsed / DURATION_MS[run.kind]);
    // The frame is 1:1 against the viewport's top left: a height change is followed, a width or
    // pixel ratio change would misplace it, so the transition leaves early.
    const moved = devicePixelRatio !== run.dpr || Math.abs(innerWidth - run.width) > 1;
    if (!moved) {
      const live = maskRects(run.options.masks(), setup.size[1]);
      stage.surface.draw(setup, { t, time: elapsed / 1000, live });
    }
    if (t < 1 && !moved) {
      run.raf = requestAnimationFrame((next) => this.frame(run, next));
      return;
    }
    this.leave(() => {
      if (this.run !== run) return;
      this.run = null;
      this.settle(run);
    });
  }

  /**
   * The stage for a new play: the one still in use, kept (what it shows fades out while the new
   * frame is captured), or a fresh canvas and context.
   */
  private claimStage(): Stage | null {
    const current = this.stage;
    if (current) {
      clearTimeout(current.timer);
      current.canvas.style.transitionDuration = `${FADE_OUT_MS}ms`;
      current.canvas.style.opacity = '0';
      return current;
    }
    const canvas = h('canvas', { class: 'frame' });
    const surface = TransitionSurface.open(canvas, () => this.stop());
    if (!surface) {
      this.unavailable = true;
      return null;
    }
    this.stage = { canvas, surface, timer: 0 };
    return this.stage;
  }

  /**
   * Fades the frame out and takes the stage away once it has, then calls `then`; at once when
   * the frame is not in the page.
   */
  private leave(then?: () => void): void {
    const stage = this.stage;
    if (stage && this.layer.element) {
      clearTimeout(stage.timer);
      stage.canvas.style.transitionDuration = `${FADE_OUT_MS}ms`;
      stage.canvas.style.opacity = '0';
      stage.timer = window.setTimeout(() => {
        this.teardown();
        then?.();
      }, FADE_OUT_MS);
      return;
    }
    this.teardown();
    then?.();
  }

  /** A play that could not start: it resolves, and the stage goes. */
  private abort(run: Run): void {
    if (this.run === run) this.run = null;
    this.settle(run);
    this.leave();
  }

  /** Ends the play in flight, if any (its promise resolves now). */
  private end(): void {
    const run = this.run;
    this.run = null;
    this.capture.cancel();
    if (!run) return;
    cancelAnimationFrame(run.raf);
    this.settle(run);
  }

  /** Ends the play and takes the stage away at once (hidden document, lost context, disposal). */
  private stop(): void {
    this.end();
    this.teardown();
  }

  private settle(run: Run): void {
    if (run.settled) return;
    run.settled = true;
    if (run.hold) this.deps.send({ type: 'transition.end', requestId: run.id });
    run.resolve();
  }

  /** Gives the context back and takes the layer out of the page. */
  private teardown(): void {
    const stage = this.stage;
    if (!stage) return;
    this.stage = null;
    clearTimeout(stage.timer);
    stage.surface.dispose();
    this.layer.root.replaceChildren();
    this.layer.unmount();
  }
}
