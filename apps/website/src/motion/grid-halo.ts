const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const REDUCED = '(prefers-reduced-motion: reduce)';

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
 * Lights the page's dot grid around a fine pointer (styles in motion.css). The halo is a fixed disc
 * that follows the pointer; inside it, a layer of brighter dots is shifted against the halo's
 * position and the scroll so its dots stay on the page grid. Both moves are transforms, written at
 * most once a frame, so the halo never repaints. Coarse pointers and reduced motion get no halo.
 */
export function initGridHalo(): () => void {
  if (!matchMedia(FINE_POINTER).matches || matchMedia(REDUCED).matches) return () => {};
  const size = cssPx('--halo-size', 360);
  const grid = cssPx('--grid', 24);

  const halo = document.createElement('div');
  halo.className = 'grid-halo';
  halo.setAttribute('aria-hidden', 'true');
  const dots = document.createElement('div');
  dots.className = 'grid-halo__dots';
  halo.append(dots);
  document.body.prepend(halo);

  let x = 0;
  let y = 0;
  let frame = 0;
  const place = () => {
    frame = 0;
    const left = x - size / 2;
    const top = y - size / 2;
    halo.style.translate = `${left}px ${top}px`;
    // The body's grid has a dot at every multiple of the pitch in page coordinates.
    dots.style.translate = `${-modulo(left + window.scrollX, grid)}px ${-modulo(top + window.scrollY, grid)}px`;
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
      halo.setAttribute('data-on', '');
      schedule();
    },
    options,
  );
  document.documentElement.addEventListener(
    'pointerleave',
    () => halo.removeAttribute('data-on'),
    options,
  );
  window.addEventListener('scroll', schedule, options);

  return () => {
    abort.abort();
    cancelAnimationFrame(frame);
    halo.remove();
  };
}
