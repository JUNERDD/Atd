import { useRef, type MouseEvent, type PointerEvent } from 'react';

/** How far, in CSS pixels, a press must move before it drags instead of clicking. */
const DRAG_THRESHOLD = 4;

/**
 * Dragging an app's card out of its window: once a press with the main mouse button moves past
 * the threshold, `onDragOut` hands it to the shell, which runs the drag natively from that press
 * (`userApp.pinDrag`). The page sees no more of that press; the click WebKit may still send when
 * the drag ends is swallowed, so the card does not also open the app. The handlers go on the
 * card's open button, which fills the card.
 */
export function usePinDrag(onDragOut: (() => void) | undefined) {
  const press = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const swallowClick = useRef(false);
  if (!onDragOut) return undefined;
  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      swallowClick.current = false;
      press.current =
        event.button === 0 && event.pointerType === 'mouse'
          ? { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
          : null;
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const start = press.current;
      if (!start || event.pointerId !== start.pointerId) return;
      if ((event.buttons & 1) === 0) {
        press.current = null;
        return;
      }
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= DRAG_THRESHOLD) return;
      press.current = null;
      swallowClick.current = true;
      onDragOut();
    },
    onPointerUp() {
      press.current = null;
    },
    onPointerCancel() {
      press.current = null;
    },
    onClickCapture(event: MouseEvent<HTMLButtonElement>) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
