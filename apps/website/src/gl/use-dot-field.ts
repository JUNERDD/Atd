import { useEffect, useRef, type RefObject } from 'react';
import { createDotField } from './dot-field';
import type { Box, DotField, DotFieldOptions, FocusRect } from './types';

export interface DotFieldRefs {
  /** The canvas to draw on, absolutely filling `root`. */
  canvas: RefObject<HTMLCanvasElement | null>;
  /**
   * The host section. It receives pointer input, its scroll-away progress drives the dissolve, and
   * it carries `data-gl="live"` while the field draws, so CSS can retire the DOM fallback.
   */
  root: RefObject<HTMLElement | null>;
  /** Element whose box the art fills; without it the engine's default placement is used. */
  art?: RefObject<HTMLElement | null>;
  /**
   * Up to two elements kept legible over the field: each padded box renders defocused and dimmer.
   * Their shape comes from CSS so it can change per breakpoint: `--dot-focus-padding`,
   * `--dot-focus-radius` and `--dot-focus-feather` on the element, in px (defaults 0, 24, 64).
   */
  focus?: readonly RefObject<HTMLElement | null>[];
}

/** Engine options. Only `text` and `reducedMotion` are applied after mount; the rest are read once. */
export type UseDotFieldOptions = Omit<
  DotFieldOptions,
  'pointerTarget' | 'onLive' | 'text' | 'reducedMotion'
> & {
  text: string;
  reducedMotion: boolean;
};

function relativeBox(box: DOMRect, base: DOMRect): Box {
  return { x: box.left - base.left, y: box.top - base.top, width: box.width, height: box.height };
}

function focusRect(element: HTMLElement, base: DOMRect): FocusRect {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const px = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const padding = px('--dot-focus-padding', 0);
  return {
    x: box.left - base.left - padding,
    y: box.top - base.top - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
    radius: px('--dot-focus-radius', 24),
    feather: px('--dot-focus-feather', 64),
  };
}

/**
 * Runs a dot field for a section. Layout is measured only when observed boxes resize: the canvas and
 * the measured elements scroll together inside the section, so their relative boxes are stable. The
 * scroll listener is passive and only hands the engine a number. Without WebGL2 nothing happens and
 * the section keeps its fallback.
 */
export function useDotField(refs: DotFieldRefs, options: UseDotFieldOptions): void {
  const latest = useRef({ refs, options });
  const fieldRef = useRef<DotField | null>(null);
  const { canvas, root } = refs;

  useEffect(() => {
    latest.current = { refs, options };
  });

  useEffect(() => {
    const canvasElement = canvas.current;
    const rootElement = root.current;
    if (!canvasElement || !rootElement) return undefined;
    const field = createDotField(canvasElement, {
      ...latest.current.options,
      pointerTarget: rootElement,
      onLive: (live) => {
        if (live) rootElement.setAttribute('data-gl', 'live');
        else rootElement.removeAttribute('data-gl');
      },
    });
    if (!field) return undefined;
    fieldRef.current = field;

    let rootTop = 0;
    let rootHeight = 0;
    let disposed = false;
    const updateScroll = () => {
      if (rootHeight > 0) field.setScroll((window.scrollY - rootTop) / rootHeight);
    };
    const measure = () => {
      if (disposed) return;
      const { art, focus = [] } = latest.current.refs;
      const base = canvasElement.getBoundingClientRect();
      const rootBox = rootElement.getBoundingClientRect();
      rootTop = rootBox.top + window.scrollY;
      rootHeight = rootBox.height;
      const artElement = art?.current;
      field.setArtBox(artElement ? relativeBox(artElement.getBoundingClientRect(), base) : null);
      field.setFocusRects(
        focus.flatMap((target) => (target.current ? [focusRect(target.current, base)] : [])),
      );
      updateScroll();
    };

    const observer = new ResizeObserver(measure);
    const { art, focus = [] } = latest.current.refs;
    for (const element of [rootElement, art?.current, ...focus.map((target) => target.current)]) {
      if (element) observer.observe(element);
    }
    window.addEventListener('scroll', updateScroll, { passive: true });
    // Web fonts can reflow the measured blocks without resizing the section.
    void document.fonts.ready.then(measure);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('scroll', updateScroll);
      field.destroy();
      fieldRef.current = null;
    };
  }, [canvas, root]);

  const { text, reducedMotion } = options;
  useEffect(() => {
    fieldRef.current?.setArt(text);
  }, [text]);
  useEffect(() => {
    fieldRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);
}
