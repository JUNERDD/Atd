import { GLOW_TIMING } from '@atd/ui/lib/glow/timing';
import type { ContentDiagReporter } from '../diag.ts';
import type { GlowMode } from '../hud/states.ts';
import { reducedMotion } from '../motion.ts';
import { samplePageLuminance } from './luminance.ts';
import { GlowStage } from './stage.ts';
import { TabGlow } from './tab-glow.ts';
import { pageDarkness } from './tones.ts';
import { signal } from '../lifetime.ts';

/**
 * While lit and shown, the page's background is sampled again this often (pages change as they
 * load).
 */
const RESAMPLE_MS = 4000;
const SCROLL_SETTLE_MS = 150;

/**
 * The continuous light at the tab's edges behind the HUD (spec 8, D13), in its own full-viewport
 * layer. Working → the working palette; attention → amber; held, stopped and failed → it leaves;
 * stopping keeps what it shows; disconnected → frozen (clock stopped, drained); done → the cyan
 * hue shift, then it leaves. Agent clicks ripple along the nearest edge (`click`). Glow effects off
 * leaves only the HUD and the pointer. On a dark page the layer adds the light to the page
 * (`GlowStage.blend`). The layer and its GPU context are in the page only while the light shows.
 */
export class EdgeLight {
  private readonly glow: TabGlow;
  private enabled = true;
  private darkness = 0;
  private doneTimer = 0;
  private sampleTimer = 0;
  private scrollTimer = 0;
  private mode: GlowMode = 'off';

  constructor(
    private readonly hud: () => DOMRectReadOnly,
    onDiag?: ContentDiagReporter,
  ) {
    this.glow = new TabGlow(new GlowStage(onDiag), () => ({
      enabled: this.enabled,
      reduce: reducedMotion(),
      darkness: this.darkness,
      hud: this.hud,
    }));
    addEventListener(
      'scroll',
      () => {
        if (!this.glow.lit || document.hidden) return;
        clearTimeout(this.scrollTimer);
        this.scrollTimer = window.setTimeout(() => this.sample(), SCROLL_SETTLE_MS);
      },
      { capture: true, passive: true, signal },
    );
    // Sampling pauses while the tab is hidden (`sample`) and starts again as it shows.
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!this.glow.lit || document.hidden) return;
        this.sample();
        this.scheduleSampling();
      },
      { signal },
    );
  }

  /** Whether the light is on (glow effects off still hides it). */
  get lit(): boolean {
    return this.glow.lit;
  }

  /** The person's glow effects setting. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.glow.refresh();
  }

  /** Follows the HUD's state (`Hud.glowMode`). */
  show(mode: GlowMode): void {
    if (mode === this.mode) return this.glow.kick();
    this.mode = mode;
    clearTimeout(this.doneTimer);
    switch (mode) {
      case 'keep':
        return this.glow.kick();
      case 'off':
        return this.glow.set(false);
      case 'done':
        // Only a light that is on shifts; a tab that loads into a finished run stays dark.
        if (!this.glow.lit) return;
        this.glow.set(true, 'done');
        this.doneTimer = window.setTimeout(
          () => this.glow.set(false, 'done'),
          (reducedMotion() ? GLOW_TIMING.quick : GLOW_TIMING.hue) * 1000,
        );
        return;
      case 'working':
      case 'attention':
      case 'frozen':
        if (!this.glow.lit) this.sample();
        this.glow.set(true, mode);
        this.scheduleSampling();
        return;
    }
  }

  /** The HUD moved or changed size: an entry still resolving follows its centre. */
  kick(): void {
    this.glow.kick();
  }

  /**
   * The agent clicked at viewport CSS px (x, y) (`PointerLayer`): a light that is on sends a brief
   * rewrite wave along the edge nearest the click.
   */
  click(x: number, y: number): void {
    this.glow.click(x, y);
  }

  /** Reduce Motion changed. */
  refresh(): void {
    this.glow.refresh();
  }

  dispose(): void {
    clearTimeout(this.doneTimer);
    clearTimeout(this.sampleTimer);
    clearTimeout(this.scrollTimer);
    this.glow.dispose();
  }

  /**
   * Reads the page under the band (hit tests and computed styles, which lay the page out). Only
   * while the tab shows: a hidden tab draws nothing, and it samples again as it is shown.
   */
  private sample(): void {
    if (document.hidden) return;
    this.darkness = pageDarkness(samplePageLuminance());
    this.glow.kick();
  }

  private scheduleSampling(): void {
    clearTimeout(this.sampleTimer);
    this.sampleTimer = window.setTimeout(() => {
      if (!this.glow.lit || document.hidden) return;
      this.sample();
      this.scheduleSampling();
    }, RESAMPLE_MS);
  }
}
