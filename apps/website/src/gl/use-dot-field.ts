import { useEffect, useRef, type RefObject } from 'react';
import { createDotField } from './dot-field';
import type { Box, DotField, DotFieldOptions } from './types';

export interface DotFieldRefs {
  /** The canvas to draw on, absolutely filling `root`. */
  canvas: RefObject<HTMLCanvasElement | null>;
  /**
   * The host section. It receives pointer input, its scroll-away progress drives the dive and the
   * dissolve, and it carries `data-gl="live"` while the field draws (or `"off"` when WebGL2 is
   * unavailable), so CSS can retire or show the DOM fallback.
   */
  root: RefObject<HTMLElement | null>;
  /** Element whose box the art fills; without it the engine's default placement is used. */
  art?: RefObject<HTMLElement | null>;
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

/**
 * Runs a dot field for a section. Layout is measured only when observed boxes resize: the canvas and
 * the measured elements scroll together inside the section, so their relative boxes are stable. The
 * scroll listener is passive and only hands the engine a number. Without WebGL2 the section is
 * marked `data-gl="off"` and keeps its fallback.
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
    if (!field) {
      rootElement.setAttribute('data-gl', 'off');
      return undefined;
    }
    fieldRef.current = field;

    let rootTop = 0;
    let rootHeight = 0;
    let disposed = false;
    const updateScroll = () => {
      if (rootHeight > 0) field.setScroll((window.scrollY - rootTop) / rootHeight);
    };
    const measure = () => {
      if (disposed) return;
      const { art } = latest.current.refs;
      const base = canvasElement.getBoundingClientRect();
      const rootBox = rootElement.getBoundingClientRect();
      rootTop = rootBox.top + window.scrollY;
      rootHeight = rootBox.height;
      const artElement = art?.current;
      field.setArtBox(artElement ? relativeBox(artElement.getBoundingClientRect(), base) : null);
      updateScroll();
    };

    const observer = new ResizeObserver(measure);
    for (const element of [rootElement, latest.current.refs.art?.current]) {
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
