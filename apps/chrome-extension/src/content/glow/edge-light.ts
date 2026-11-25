import { GLOW_TIMING } from '@atd/ui/lib/glow/timing';
import type { GlowMode } from '../hud/hud.ts';
import { reducedMotion } from '../motion.ts';
import { samplePageLuminance } from './luminance.ts';
import { GlowStage } from './stage.ts';
import { TabGlow } from './tab-glow.ts';
import { pageDarkness } from './tones.ts';
import { signal } from '../lifetime.ts';

/** While lit, the page's background is sampled again this often (pages change as they load). */
const RESAMPLE_MS = 4000;
const SCROLL_SETTLE_MS = 150;

/**
 * The continuous light at the tab's edges behind the HUD (spec 8, D13), in its own full-viewport
 * layer. Working → the working palette; attention → amber; held, stopped and failed → it leaves;
 * stopping keeps what it shows; disconnected → frozen (clock stopped, drained); done → the cyan
 * hue shift, then it leaves. Glow effects off leaves only the HUD and the pointer. On a dark page
 * the layer adds the light to the page (`GlowStage.blend`). The layer and its GPU context are in
 * the page only while the light shows.
 */
export class EdgeLight {
  private readonly glow: TabGlow;
  private enabled = true;
  private darkness = 0;
  private doneTimer = 0;
  private sampleTimer = 0;
  private scrollTimer = 0;
  private mode: GlowMode = 'off';

  constructor(private readonly hud: () => DOMRectReadOnly) {
    this.glow = new TabGlow(new GlowStage(), () => ({
      enabled: this.enabled,
      reduce: reducedMotion(),
      darkness: this.darkness,
      hud: this.hud,
    }));
    addEventListener(
      'scroll',
      () => {
        if (!this.glow.lit) return;
        clearTimeout(this.scrollTimer);
        this.scrollTimer = window.setTimeout(() => this.sample(), SCROLL_SETTLE_MS);
      },
      { capture: true, passive: true, signal },
    );
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

  /** The HUD moved or changed size: the arrival and the attention mist follow it. */
  kick(): void {
    this.glow.kick();
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

  private sample(): void {
    this.darkness = pageDarkness(samplePageLuminance());
    this.glow.kick();
  }

  private scheduleSampling(): void {
    clearTimeout(this.sampleTimer);
    this.sampleTimer = window.setTimeout(() => {
      if (!this.glow.lit) return;
      this.sample();
      this.scheduleSampling();
    }, RESAMPLE_MS);
  }
}
