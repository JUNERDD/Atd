import { GLOW_DONE_HUE, GLOW_TIMING } from '@atd/ui/lib/glow/timing';
import { GLYPH_ARRIVAL_SECONDS, GLYPH_CLICK_SECONDS, GLYPH_MAX_CLICKS } from './glyph.ts';
import type { GlowCanvas, GlowStage } from './stage.ts';
import { type ToneMix, bandFor, isAdditive, levelFor, tonesFor } from './tones.ts';
import { signal } from '../lifetime.ts';

export type GlowPalette = 'working' | 'attention' | 'frozen' | 'done';

export interface GlowEnv {
  /** The person's glow effects setting (D13). */
  enabled: boolean;
  reduce: boolean;
  /** How dark the page is under the band (`pageDarkness`). */
  darkness: number;
  /** The HUD's box in viewport CSS px: the light's entry resolves outward from its centre. */
  hud(): DOMRectReadOnly;
}

/** The palette blend and hue settle in about 0.45 s (`IslandGlowStyle.hueDuration`). */
const EASE_RATE = 7;
const FREEZE_RATE = 5;
const DONE_HUE = (GLOW_DONE_HUE * Math.PI) / 180;
const SETTLED = 0.001;

/** An agent click in viewport CSS px, and when it landed (`performance.now()`). */
interface Click {
  x: number;
  y: number;
  at: number;
}

/**
 * One light per tab, ported from the prototype's `TabGlow`. `set` drives it; the clock, the
 * palette blend, the hue shift and the freeze are eased here, so a change of state never restarts
 * the light. It resolves out of the HUD when it comes on (not under Reduce Motion), its clock
 * gathering (running ahead and easing back) as the panel's waiting light does. Reduce Motion keeps
 * the clock's pace, as the prototype does: the shader itself stills the light. A frozen light's
 * clock stops, and once it has settled no frames are drawn until something changes. Recent agent
 * clicks are kept for the shader's rewrite wave while it runs. Hidden tabs get no animation
 * frames, so the light pauses with them. The canvas and its GPU context exist only while the light
 * shows: they are taken from the stage when it comes on (with glow effects on) and given back once
 * its exit fade has ended.
 */
export class TabGlow {
  private on = false;
  private readonly target: ToneMix & { hue: number } = { attention: 0, frozen: 0, hue: 0 };
  private current: ToneMix & { hue: number } = { attention: 0, frozen: 0, hue: 0 };
  private clock = 0;
  private gather = 0;
  private since = 0;
  private entry = false;
  /** The most recent first, at most `GLYPH_MAX_CLICKS`, none older than its wave. */
  private clicks: Click[] = [];
  private raf = 0;
  private last = 0;
  private fadeUntil = 0;
  private visible = false;
  private additive = false;
  private drawn: GlowCanvas | null = null;
  private releaseTimer = 0;

  constructor(
    private readonly stage: GlowStage,
    private readonly env: () => GlowEnv,
  ) {
    addEventListener('resize', () => this.kick(), { signal });
    document.addEventListener('visibilitychange', () => this.kick(), { signal });
  }

  get lit(): boolean {
    return this.on;
  }

  set(on: boolean, palette: GlowPalette = 'working'): void {
    const env = this.env();
    this.target.attention = palette === 'attention' ? 1 : 0;
    this.target.frozen = palette === 'frozen' ? 1 : 0;
    this.target.hue = palette === 'done' ? DONE_HUE : 0;
    if (on && !this.on) {
      this.since = 0;
      this.entry = !env.reduce;
      this.gather = this.entry ? 1 : 0;
      this.current = { ...this.target };
    }
    this.on = on;
    this.refresh();
  }

  /** An agent click at viewport CSS px (x, y): a light that is on answers it with a wave. */
  click(x: number, y: number): void {
    if (!this.on) return;
    this.clicks = [{ x, y, at: performance.now() }, ...this.clicks].slice(0, GLYPH_MAX_CLICKS);
    this.kick();
  }

  /** Applies the environment (setting, Reduce Motion) to the canvas and draws again. */
  refresh(): void {
    const env = this.env();
    const wanted = this.on && env.enabled;
    if (wanted && !this.drawn) this.drawn = this.stage.open();
    const drawn = this.drawn;
    const visible = wanted && drawn !== null;
    if (drawn) {
      const fade = visible ? GLOW_TIMING.quick : env.reduce ? GLOW_TIMING.quick : GLOW_TIMING.exit;
      drawn.canvas.style.setProperty('transition-duration', `${fade}s`);
      if (visible && !this.visible) {
        clearTimeout(this.releaseTimer);
        // A canvas that just arrived fades in from its first style.
        void drawn.canvas.offsetWidth;
        drawn.canvas.classList.add('on');
      } else if (!visible && this.visible) {
        drawn.canvas.classList.remove('on');
        // Frames continue through the fade-out; then the context goes back.
        const ends = fade * 1000 + 50;
        this.fadeUntil = performance.now() + ends;
        this.releaseTimer = window.setTimeout(() => this.release(), ends);
      }
    }
    this.visible = visible;
    this.kick();
  }

  kick(): void {
    if (!this.drawn || this.raf || document.visibilityState === 'hidden') return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  /** The instance is going away: the context goes back at once. */
  dispose(): void {
    clearTimeout(this.releaseTimer);
    this.visible = false;
    this.release();
  }

  private release(): void {
    if (this.visible) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.drawn = null;
    this.stage.close();
  }

  private frame(now: number): void {
    this.raf = 0;
    const drawn = this.drawn;
    if (!drawn || (!this.visible && now >= this.fadeUntil)) return;
    const env = this.env();
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    const ease = (key: 'attention' | 'frozen' | 'hue', rate: number) => {
      this.current[key] += (this.target[key] - this.current[key]) * (1 - Math.exp(-dt * rate));
    };
    ease('attention', EASE_RATE);
    ease('hue', EASE_RATE);
    ease('frozen', FREEZE_RATE);
    this.since += dt;
    if (this.gather > 0) this.gather = Math.max(0, this.gather - dt / GLOW_TIMING.entry);
    const running = 1 - this.current.frozen;
    this.clock += dt * running * (1 + 4 * this.gather * this.gather);
    // A click's wave runs on real time, so it plays out even while the clock stops.
    this.clicks = this.clicks.filter((click) => now - click.at <= GLYPH_CLICK_SECONDS * 1000);

    const additive = isAdditive(env.darkness);
    if (additive !== this.additive) {
      this.additive = additive;
      this.stage.blend(additive);
    }
    drawn.surface.draw({
      phase: this.clock,
      since: this.since,
      entry: this.entry,
      hud: env.hud(),
      band: bandFor(env.darkness),
      level: levelFor(env.darkness, this.current),
      hue: this.current.hue,
      darkness: env.darkness,
      attention: this.current.attention,
      frozen: this.current.frozen,
      reduce: env.reduce,
      tones: tonesFor(env.darkness, this.current),
      clicks: this.clicks.map((click) => ({
        x: click.x,
        y: click.y,
        age: Math.max(0, (now - click.at) / 1000),
      })),
    });
    if (!this.settled()) this.raf = requestAnimationFrame((next) => this.frame(next));
  }

  /**
   * A frozen light whose blend and entry have come to rest, with no click wave running, draws
   * nothing new until kicked.
   */
  private settled(): boolean {
    if (
      !this.on ||
      this.gather > 0 ||
      this.clicks.length > 0 ||
      (this.entry && this.since < GLYPH_ARRIVAL_SECONDS)
    ) {
      return false;
    }
    const resting = (['attention', 'frozen', 'hue'] as const).every(
      (key) => Math.abs(this.target[key] - this.current[key]) < SETTLED,
    );
    return resting && this.current.frozen > 1 - SETTLED;
  }
}
