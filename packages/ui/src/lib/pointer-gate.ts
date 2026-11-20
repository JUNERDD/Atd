import type * as React from 'react';
import { isComposingKey } from '@atd/ui/lib/ime';

/** Minimal pointer or mouse event fields inspected by {@link PointerGate}. */
export interface PointerLikeEvent {
  clientX: number;
  clientY: number;
  pointerType?: string | undefined;
  currentTarget?: EventTarget | null | undefined;
}

/** Coordinates keyboard navigation with pointer movement so stationary cursors do not steal focus. */
export interface PointerGate {
  lock: () => void;
  allowMove: (event: PointerLikeEvent) => boolean;
  allowLeave: (event: PointerLikeEvent) => boolean;
}

interface Point {
  x: number;
  y: number;
}

const LIST_NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown']);

let lastMousePoint: Point | null = null;
let trackingInstalled = false;

function ensureTracking(): void {
  if (trackingInstalled || typeof window === 'undefined') return;
  trackingInstalled = true;
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!event.pointerType || event.pointerType === 'mouse') {
        lastMousePoint = { x: event.clientX, y: event.clientY };
      }
    },
    { capture: true, passive: true },
  );
}

/** Whether `key` is a vertical or paging list navigation key. */
export function isListNavKey(key: string): boolean {
  return LIST_NAV_KEYS.has(key);
}

/**
 * Create a gate that suppresses stationary or non-mouse pointer moves/leaves after keyboard
 * navigation (or initially on mount) until a mouse pointer moves to a new coordinate.
 */
export function createPointerGate(initiallyLocked = false): PointerGate {
  ensureTracking();
  let locked = initiallyLocked;
  let lockedPoint: Point | null = initiallyLocked ? lastMousePoint : null;

  return {
    lock() {
      ensureTracking();
      locked = true;
      lockedPoint = lastMousePoint;
    },
    allowMove(event) {
      ensureTracking();
      if (event.pointerType && event.pointerType !== 'mouse') return false;

      lastMousePoint = { x: event.clientX, y: event.clientY };
      if (!locked) return true;

      const rect =
        typeof Element !== 'undefined' && event.currentTarget instanceof Element
          ? event.currentTarget.getBoundingClientRect()
          : null;
      const hasLayout = Boolean(rect && (rect.width > 0 || rect.height > 0));
      if (
        !hasLayout &&
        event.clientX === 0 &&
        event.clientY === 0 &&
        (!lockedPoint || (lockedPoint.x === 0 && lockedPoint.y === 0))
      ) {
        locked = false;
        lockedPoint = null;
        return true;
      }

      if (lockedPoint === null) {
        lockedPoint = { x: event.clientX, y: event.clientY };
        return false;
      }
      if (event.clientX === lockedPoint.x && event.clientY === lockedPoint.y) {
        return false;
      }

      locked = false;
      lockedPoint = null;
      return true;
    },
    allowLeave(event) {
      return (!event.pointerType || event.pointerType === 'mouse') && !locked;
    },
  };
}

/** Lock a menu pointer gate on list navigation or typeahead keys during capture. */
export function gateMenuKeyDownCapture<T extends HTMLElement>(
  gate: PointerGate,
  onKeyDownCapture?: React.KeyboardEventHandler<T>,
): React.KeyboardEventHandler<T> {
  return (event) => {
    onKeyDownCapture?.(event);
    if (
      !isComposingKey(event) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (isListNavKey(event.key) || event.key.length === 1)
    ) {
      gate.lock();
    }
  };
}

/** Gate menu or select item pointer move/leave handlers while preserving caller callbacks. */
export function gateItemPointerProps<T extends HTMLElement>(
  gate: PointerGate | null,
  onPointerMove?: React.PointerEventHandler<T>,
  onPointerLeave?: React.PointerEventHandler<T>,
  requireActiveOnLeave = true,
) {
  return {
    onPointerMove: (event: React.PointerEvent<T>) => {
      onPointerMove?.(event);
      if (gate && !gate.allowMove(event)) event.preventDefault();
    },
    onPointerLeave: (event: React.PointerEvent<T>) => {
      onPointerLeave?.(event);
      if (!gate) return;
      const inactive = requireActiveOnLeave && event.currentTarget !== document.activeElement;
      if (!gate.allowLeave(event) || inactive) event.preventDefault();
    },
  };
}
