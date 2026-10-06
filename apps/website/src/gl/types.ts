/** RGB color with channels in 0..1. */
export type Rgb = readonly [red: number, green: number, blue: number];

/** Box in CSS px, relative to the canvas's top-left corner. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DotFieldOptions {
  /**
   * Words drawn as lit dots, shown in turn: the first powers on, then in full motion the board
   * changes word by word like a flip-dot sign and loops. `|` marks where a word may break onto two
   * lines when that sets it larger. Default ["Atd"].
   */
  words?: readonly string[];
  /**
   * Allowed dot pitch in CSS px; the engine picks one inside it from the smallest word's size.
   * Default [10, 14].
   */
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
  /** Element that receives pointer input for the lens and ripples. Default: the canvas. */
  pointerTarget?: HTMLElement;
  /** Start in reduced-motion mode. Default false. */
  reducedMotion?: boolean;
  /**
   * Play the power-on sequence on the first frame (never under reduced motion): the picture opens
   * from a line like a CRT, then a scan resolves the art out of static. Default true.
   */
  boot?: boolean;
  /**
   * Called with true once a frame is on screen, and with false when the field stops drawing
   * (context loss or destroy), so the host can swap its fallback in and out.
   */
  onLive?: (live: boolean) => void;
  /** Called with a word's index as the board starts changing to it. */
  onWord?: (index: number) => void;
}

export interface DotField {
  /** Replaces the words; they are re-rasterized on the next frame and the cycle starts over. */
  setWords(words: readonly string[]): void;
  /** Box the art fills (contain-fit, centered); null restores the default placement. */
  setArtBox(box: Box | null): void;
  /**
   * Scroll-away progress of the host section: 0 in place, 1 scrolled out. The panel dives toward
   * the viewer around the art while the art dissolves.
   */
  setScroll(progress: number): void;
  setReducedMotion(reduced: boolean): void;
  /**
   * Stops drawing, removes every listener and observer, and deletes the GL objects. The context is
   * kept (not lost on purpose) so a remount on the same canvas, as in StrictMode, can reuse it.
   */
  destroy(): void;
}
