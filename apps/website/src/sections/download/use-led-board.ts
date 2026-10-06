import { useEffect, type RefObject } from 'react';
import { useInView } from '../../lib/use-in-view';

const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const REDUCED = '(prefers-reduced-motion: reduce)';
/** Lens radii in cells: dots inside the inner ring swell most. */
const INNER = 1.6;
const OUTER = 3.2;

/**
 * Wires the LED board's script-side motion and returns whether it is on screen (its idle wave runs
 * only then). Each dot gets its column as `--col`, which the CSS power-on and wave stagger by. Under
 * a fine pointer the board is a loupe: dots within a few cells of the pointer swell
 * (`data-near="1" | "2"`), updated at most once a frame.
 */
export function useLedBoard(boardRef: RefObject<HTMLElement | null>): boolean {
  const near = useInView(boardRef, { rootMargin: '80px 0px' });

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const dots = Array.from(board.querySelectorAll<SVGCircleElement>('circle'));
    const cells = dots.map((dot) => ({
      dot,
      x: Number(dot.getAttribute('cx')),
      y: Number(dot.getAttribute('cy')),
    }));
    for (const { dot, x } of cells) dot.style.setProperty('--col', String(Math.floor(x)));
    if (!matchMedia(FINE_POINTER).matches || matchMedia(REDUCED).matches) return;

    const svg = board.querySelector('svg');
    const columns = Math.max(1, ...cells.map((cell) => cell.x + 0.5));
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const apply = () => {
      frame = 0;
      const box = svg?.getBoundingClientRect();
      if (!box) return;
      const cell = box.width / columns;
      for (const { dot, x, y } of cells) {
        const distance = pointer
          ? Math.hypot(box.left + x * cell - pointer.x, box.top + y * cell - pointer.y) / cell
          : Infinity;
        const level = distance < INNER ? '2' : distance < OUTER ? '1' : null;
        if (level === dot.getAttribute('data-near')) continue;
        if (level) dot.setAttribute('data-near', level);
        else dot.removeAttribute('data-near');
      }
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    const abort = new AbortController();
    const options = { passive: true, signal: abort.signal };
    board.addEventListener(
      'pointermove',
      (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        schedule();
      },
      options,
    );
    board.addEventListener(
      'pointerleave',
      () => {
        pointer = null;
        schedule();
      },
      options,
    );
    return () => {
      abort.abort();
      cancelAnimationFrame(frame);
    };
  }, [boardRef]);

  return near;
}
