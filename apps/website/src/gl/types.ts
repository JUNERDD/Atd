/** RGB color with channels in 0..1. */
export type Rgb = readonly [red: number, green: number, blue: number];

/** Box in CSS px, relative to the canvas's top-left corner. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Region where the field renders defocused and dimmer, so DOM text placed over it stays legible
 * without a CSS backdrop filter. The box itself is fully defocused; the falloff runs outward.
 */
export interface FocusRect extends Box {
  /** Corner radius in CSS px. */
  radius: number;
  /** Width of the soft falloff outside the box, in CSS px. */
  feather: number;
}

export interface DotFieldOptions {
  /** Text drawn as lit dots. Default "Atd". */
  text?: string;
  /** Allowed dot pitch in CSS px; the engine picks one inside it from the art height. Default [10, 14]. */
  pitch?: readonly [min: number, max: number];
  /** CSS font-family list used to rasterize the art. Default: the system UI stack. */
  fontFamily?: string;
  /** Font weight used to rasterize the art. Default 900. */
  fontWeight?: number;
  /** Background color. Default black. */
  ink?: Rgb;
  /** Dot color at full brightness. Default white. */
  dot?: Rgb;
  /** Brightness of unlit field dots, 0..1. Default 0.13. */
  fieldLevel?: number;
  /** How much focus rects dim the field, 0..1. Default 0.65. */
  focusDim?: number;
  /** Element that receives pointer input for the lens and ripples. Default: the canvas. */
  pointerTarget?: HTMLElement;
  /** Start in reduced-motion mode. Default false. */
  reducedMotion?: boolean;
  /** Play the power-on sequence on the first frame (never under reduced motion). Default true. */
  boot?: boolean;
  /**
   * Called with true once a frame is on screen, and with false when the field stops drawing
   * (context loss or destroy), so the host can swap its fallback in and out.
   */
  onLive?: (live: boolean) => void;
}

export interface DotField {
  /** Replaces the art text; it is re-rasterized on the next frame. */
  setArt(text: string): void;
  /** Box the art fills (contain-fit, centered); null restores the default placement. */
  setArtBox(box: Box | null): void;
  /** Up to two focus rects; extra entries are ignored. */
  setFocusRects(rects: readonly FocusRect[]): void;
  /** Scroll-away progress of the host section: 0 in place, 1 scrolled out. */
  setScroll(progress: number): void;
  setReducedMotion(reduced: boolean): void;
  /**
   * Stops drawing, removes every listener and observer, and deletes the GL objects. The context is
   * kept (not lost on purpose) so a remount on the same canvas, as in StrictMode, can reuse it.
   */
  destroy(): void;
}
