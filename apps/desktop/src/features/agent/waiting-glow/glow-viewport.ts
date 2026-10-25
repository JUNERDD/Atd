import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { PaperShaderElement } from '@paper-design/shaders-react';

/**
 * Keep the drawing buffer at the band's largest height during a visible wait. A composer shrink
 * changes the shader's logical band instead of reallocating its canvas on every spring frame.
 * Pixels stay at their original scale: the shader crops the spare area, never stretches a bitmap.
 * Once dark, release the spare buffer. Growing the composer or resizing the window still fits it.
 */
export function useGlowViewport(
  ref: RefObject<PaperShaderElement | null>,
  running: boolean,
  maxPixels: number,
) {
  const ratio = useRef(1);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const band = canvas?.parentElement;
    if (!canvas || !band) return;
    let allocated = 0;
    const sync = (width: number, height: number) => {
      if (height <= 0) return;
      allocated = Math.max(allocated, height);
      const scale = Math.max(1, window.devicePixelRatio) * (visualViewport?.scale ?? 1);
      // Above Paper's pixel budget, a shorter buffer earns a higher pixel density. Keep its
      // normal resizing there rather than pinning the light at a lower resolution after shrink.
      const pinned = running && Math.round(width) * Math.round(allocated) * scale ** 2 <= maxPixels;
      const style = pinned ? `${allocated}px` : '';
      if (canvas.style.height !== style) canvas.style.height = style;
      const next = pinned ? height / allocated : 1;
      if (next !== ratio.current) {
        ratio.current = next;
        if (!document.hidden && document.documentElement.dataset.windowVisible !== 'false') {
          canvas.paperShaderMount?.setUniforms({ u_bandRatio: next });
        }
      }
    };
    const measure = () => {
      const { width, height } = band.getBoundingClientRect();
      sync(width, height);
    };
    measure();
    const observer = new ResizeObserver(([entry]) => {
      if (entry) sync(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(band);
    visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      visualViewport?.removeEventListener('resize', measure);
      canvas.style.height = '';
    };
  }, [ref, running, maxPixels]);
  return ratio;
}
