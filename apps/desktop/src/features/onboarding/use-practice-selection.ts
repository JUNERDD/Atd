import { useEffect, type RefObject } from 'react';
import type { SurfaceRect } from '../../client/contract';
import { MAX_PRACTICE_SELECTION_LENGTH } from '../../native-bridge/contract';

/**
 * How long a selection must stay unchanged before it is reported, outside a drag (which reports on
 * release): a keyboard selection grows a step at a time.
 */
const SETTLE_MS = 150;

interface PracticeSelection {
  rect: SurfaceRect;
  text: string;
  /** Text and box together: the same selection in the same place. */
  key: string;
}

/** The page's selection when it is non-empty and lies wholly inside `element`. */
function readSelection(element: HTMLElement): PracticeSelection | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const text = selection.toString().slice(0, MAX_PRACTICE_SELECTION_LENGTH);
  if (!text.trim()) return null;
  // The shell takes no negatives; a box partly above or left of the viewport is cut there.
  const box = range.getBoundingClientRect();
  const x = Math.max(0, box.left);
  const y = Math.max(0, box.top);
  const rect = { x, y, width: Math.max(0, box.right - x), height: Math.max(0, box.bottom - y) };
  return { rect, text, key: `${rect.x},${rect.y},${rect.width},${rect.height}\n${text}` };
}

/**
 * Reports text selected inside `element` to the shell (`onboarding.selection`) while `active`, so
 * the real selection toolbar shows beside it: when a drag ends, or once a selection made otherwise
 * (keyboard, double click) settles. It reports `null` when the selection collapses or leaves the
 * element, on any press, key, scroll or window resize, and when it stops (`active` turns false: a
 * step change, the guide closing, the toolbar's conditions lost, or unmount). A key hides the
 * toolbar for good until the selection changes. Window blur is left alone: clicking the toolbar,
 * a window of its own, must not hide it first. Without the shell's bridge it does nothing.
 */
export function usePracticeSelection(element: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const bridge = window.desktop?.onboarding;
    const area = element.current;
    if (!active || !bridge || !area) return;
    let shown: string | null = null;
    /** The selection a key hid, which stays hidden until it changes. */
    let dismissed: string | null = null;
    let dragging = false;
    let timer = 0;

    const hide = () => {
      window.clearTimeout(timer);
      timer = 0;
      if (shown === null) return;
      shown = null;
      bridge.selection(null, '');
    };
    const report = () => {
      timer = 0;
      const next = readSelection(area);
      if (!next) {
        dismissed = null;
        hide();
        return;
      }
      if (next.key === shown || next.key === dismissed) return;
      dismissed = null;
      shown = next.key;
      bridge.selection(next.rect, next.text);
    };
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(report, delay);
    };

    const onPointerDown = () => {
      dragging = true;
      hide();
    };
    const onPointerUp = () => {
      dragging = false;
      schedule(0);
    };
    const onSelectionChange = () => {
      if (!dragging) schedule(SETTLE_MS);
    };
    const onKeyDown = () => {
      dismissed = readSelection(area)?.key ?? null;
      hide();
    };
    const onKeyUp = () => schedule(SETTLE_MS);
    const listeners: [EventTarget, string, () => void, AddEventListenerOptions?][] = [
      [document, 'pointerdown', onPointerDown, { capture: true }],
      [document, 'pointerup', onPointerUp, { capture: true }],
      [document, 'pointercancel', onPointerUp, { capture: true }],
      [document, 'selectionchange', onSelectionChange],
      [document, 'keydown', onKeyDown, { capture: true }],
      [document, 'keyup', onKeyUp, { capture: true }],
      // Any scroll (the card body, the practice area) moves the text from under the toolbar.
      [document, 'scroll', hide, { capture: true, passive: true }],
      [window, 'resize', hide],
    ];
    for (const [target, type, listener, options] of listeners) {
      target.addEventListener(type, listener, options);
    }
    // A selection already standing when the area becomes active shows at once.
    schedule(0);
    return () => {
      for (const [target, type, listener, options] of listeners) {
        target.removeEventListener(type, listener, options);
      }
      window.clearTimeout(timer);
      bridge.selection(null, '');
    };
  }, [element, active]);
}
