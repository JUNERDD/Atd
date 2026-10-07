const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const REDUCED = '(prefers-reduced-motion: reduce)';
/** The plates whose perforations the halo lights (base.css `.plate`). */
const PLATE = '.plate';

function modulo(value: number, step: number): number {
  return ((value % step) + step) % step;
}

function cssPx(name: string, fallback: number): number {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Lights a plate's perforations around a fine pointer (styles in motion.css). The halo is a fixed
 * disc that follows the pointer; inside it, a layer of brighter dots is shifted onto the grid of
 * the plate under the pointer, and clipped to that plate, since each plate registers its grid to
 * its own top edge (base.css). The moves are transforms and the clip a small repaint, written at
 * most once a frame. Coarse pointers and reduced motion get no halo.
 */
export function initGridHalo(): () => void {
  if (!matchMedia(FINE_POINTER).matches || matchMedia(REDUCED).matches) return () => {};
  const size = cssPx('--halo-size', 360);
  const grid = cssPx('--grid', 24);
  const plates = Array.from(document.querySelectorAll<HTMLElement>(PLATE));
  if (plates.length === 0) return () => {};

  const halo = document.createElement('div');
  halo.className = 'grid-halo';
  halo.setAttribute('aria-hidden', 'true');
  const dots = document.createElement('div');
  dots.className = 'grid-halo__dots';
  halo.append(dots);
  document.body.prepend(halo);

  let x = 0;
  let y = 0;
  let pointed = false;
  let frame = 0;
  const place = () => {
    frame = 0;
    const plate = plates
      .map((element) => element.getBoundingClientRect())
      .find((box) => y >= box.top && y < box.bottom);
    if (!pointed || !plate) {
      halo.removeAttribute('data-on');
      return;
    }
    const left = x - size / 2;
    const top = y - size / 2;
    halo.setAttribute('data-on', '');
    halo.style.translate = `${left}px ${top}px`;
    halo.style.clipPath = `inset(${Math.max(0, plate.top - top)}px 0 ${Math.max(0, top + size - plate.bottom)}px 0)`;
    // The plate's dot columns sit half a pitch either side of its center line, its rows half a
    // pitch below its top; the layer's own dots sit half a pitch in from its corner.
    dots.style.translate = `${-modulo(left - plate.left - plate.width / 2, grid)}px ${-modulo(top - plate.top, grid)}px`;
  };
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(place);
  };

  const abort = new AbortController();
  const options = { passive: true, signal: abort.signal };
  document.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse') return;
      x = event.clientX;
      y = event.clientY;
      pointed = true;
      schedule();
    },
    options,
  );
  document.documentElement.addEventListener(
    'pointerleave',
    () => {
      pointed = false;
      schedule();
    },
    options,
  );
  window.addEventListener('scroll', schedule, options);

  return () => {
    abort.abort();
    cancelAnimationFrame(frame);
    halo.remove();
  };
}
