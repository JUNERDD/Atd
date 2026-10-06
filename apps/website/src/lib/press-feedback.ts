/** Glass surfaces that catch a highlight from the pointer (the kit's `--px` / `--py` hooks). */
const GLASS = '.glass, .btn-glass, .btn-prominent';
/** Opaque surfaces that catch a spotlight (motion.css `--spot-x` / `--spot-y` hooks). */
const SPOTLIGHT = '[data-spotlight]';

/**
 * Page-wide press and pointer feedback for the Apple kit's controls and the site's surfaces, set up
 * once from the entry.
 *
 * - iOS Safari applies `:active` only while some touch listener exists, so pressed states need one.
 * - A fine pointer moving over glass moves the glint: the hovered surface gets the pointer position
 *   as percentages. Over a spotlight surface it moves the light: the position in px. Both are
 *   written at most once per frame.
 */
export function initPressFeedback(): void {
  document.addEventListener('touchstart', () => {}, { passive: true });
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  let frame = 0;
  let last: PointerEvent | null = null;
  const apply = () => {
    frame = 0;
    if (!last || !(last.target instanceof Element)) return;
    const glass = last.target.closest<HTMLElement>(GLASS);
    if (glass) {
      const box = glass.getBoundingClientRect();
      glass.style.setProperty('--px', `${((last.clientX - box.left) / box.width) * 100}%`);
      glass.style.setProperty('--py', `${((last.clientY - box.top) / box.height) * 100}%`);
    }
    const surface = last.target.closest<HTMLElement>(SPOTLIGHT);
    if (surface) {
      const box = surface.getBoundingClientRect();
      surface.style.setProperty('--spot-x', `${last.clientX - box.left}px`);
      surface.style.setProperty('--spot-y', `${last.clientY - box.top}px`);
    }
  };
  document.addEventListener(
    'pointermove',
    (event) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    },
    { passive: true },
  );
}
