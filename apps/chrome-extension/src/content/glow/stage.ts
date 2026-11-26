import { h } from '../dom.ts';
import { Layer } from '../hosts.ts';
import glowCss from './glow.css?inline';
import { GlowSurface } from './runner.ts';

/** A canvas in the page with its live WebGL2 context. */
export interface GlowCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly surface: GlowSurface;
}

/**
 * The light's layer and GPU context, held only while the light is shown: `open` builds a fresh
 * canvas and context and puts the layer in the page, `close` gives the context back
 * (`WEBGL_lose_context`) and takes the layer out again. A machine or page where no context can be
 * had (or only a software one) is remembered, and the light stays off there without the layer
 * ever being added.
 */
export class GlowStage {
  private readonly layer = new Layer('atd-glow', [glowCss]);
  private current: GlowCanvas | null = null;
  private unavailable = false;

  constructor() {
    this.layer.root.setAttribute('aria-hidden', 'true');
  }

  /** The canvas while the light is in the page; a new one when it was not. */
  open(): GlowCanvas | null {
    if (this.current || this.unavailable) return this.current;
    const canvas = h('canvas', { class: 'glow' });
    const surface = new GlowSurface(canvas);
    if (!surface.supported) {
      surface.dispose();
      this.unavailable = true;
      return null;
    }
    this.layer.root.replaceChildren(canvas);
    this.layer.mount();
    this.current = { canvas, surface };
    return this.current;
  }

  /** Releases the context and takes the layer out of the page. */
  close(): void {
    const current = this.current;
    if (!current) return;
    this.current = null;
    current.surface.dispose();
    this.layer.root.replaceChildren();
    this.layer.unmount();
  }

  /**
   * The dark-page profile adds the light to the page: `plus-lighter` on the host itself (a
   * z-indexed host is an isolated group, so a blend inside it would never reach the page).
   */
  blend(additive: boolean): void {
    this.layer.setStyle('mix-blend-mode', additive ? 'plus-lighter' : null);
  }
}
