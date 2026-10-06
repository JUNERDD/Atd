/** Glass surfaces that catch a highlight from the pointer (the kit's `--px` / `--py` hooks). */
const GLASS = '.glass, .btn-glass, .btn-prominent';

/**
 * Page-wide press and glass feedback for the Apple kit's controls, set up once from the entry.
 *
 * - iOS Safari applies `:active` only while some touch listener exists, so pressed states need one.
 * - A fine pointer moving over glass moves the glint: the hovered surface gets the pointer position
 *   as percentages, at most once per frame.
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
    if (!glass) return;
    const box = glass.getBoundingClientRect();
    glass.style.setProperty('--px', `${((last.clientX - box.left) / box.width) * 100}%`);
    glass.style.setProperty('--py', `${((last.clientY - box.top) / box.height) * 100}%`);
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
