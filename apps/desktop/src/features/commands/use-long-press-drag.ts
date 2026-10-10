import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react';
import { animate, type DragControls, type ResolvedValues } from 'motion/react';

/** How long the pointer rests on a row before the row lifts and follows it. */
const HOLD_MS = 350;
/** Movement that turns a press into something other than a hold (a stray drag, a scroll). */
const SLOP_PX = 4;
/** Frames without movement after which a released row short of its slot is sent home. */
const STALL_FRAMES = 3;
/** The slide home when Motion's own snap back stopped short; a second stop jumps home. */
const HOME = { duration: 0.15, ease: 'easeOut' } as const;

/**
 * Starts a Motion drag once the primary pointer has been held on the row without moving, so a
 * short click still opens the editor. The row lifts when the hold completes, before it moves, and
 * stays lifted until it is back in its slot. The click that ends a held press is reported by
 * `consumeHold` so it does not open the editor too.
 *
 * A released row settles when its offset reaches zero, as the item's `onUpdate` reports it, not
 * when Motion's snap back resolves: an interrupted snap never resolves, which left a row lifted
 * and short of its slot. A released row whose offset stops short is animated home through its
 * element, which drives the same offset Motion does.
 */
export function useLongPressDrag(controls: DragControls, enabled: boolean) {
  // The pending hold: its timer, where it began, and the latest pointer event, which starts the
  // drag so the row does not jump by the movement inside the slop.
  const pending = useRef<{ timer: number; x: number; y: number; event: globalThis.PointerEvent }>(
    null,
  );
  const held = useRef(false);
  // Motion's drag began: the release waits for the row to get home instead of settling at once.
  const moved = useRef(false);
  // The item element and its offset along the list, as Motion last rendered it.
  const row = useRef<HTMLLIElement>(null);
  const offset = useRef(0);
  const updated = useRef(false);
  // The frame watching a released row on its way home.
  const watching = useRef(0);
  const [lifted, setLifted] = useState(false);
  // The pointer is down on a row that can move and the hold has not completed yet.
  const [arming, setArming] = useState(false);

  function cancel() {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    setArming(false);
  }
  function stopWatching() {
    cancelAnimationFrame(watching.current);
    watching.current = 0;
  }
  function settle() {
    stopWatching();
    moved.current = false;
    setLifted(false);
  }
  /** Each frame after the release: settle once home, or send home a row that stopped short. */
  function watch() {
    let still = 0;
    let sent = 0;
    const step = () => {
      if (offset.current === 0) return settle();
      if (updated.current) still = 0;
      else if (++still >= STALL_FRAMES && row.current) {
        still = 0;
        void animate(row.current, { y: 0 }, sent++ ? { duration: 0 } : HOME);
      }
      updated.current = false;
      watching.current = requestAnimationFrame(step);
    };
    stopWatching();
    watching.current = requestAnimationFrame(step);
  }
  useEffect(
    () => () => {
      cancel();
      stopWatching();
    },
    [],
  );
  // A lifted row that never moved settles wherever the pointer is released, on the row or not; a
  // moved one settles once it is home.
  const release = useEffectEvent(() => (moved.current ? watch() : settle()));
  useEffect(() => {
    if (!lifted) return;
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [lifted]);

  return {
    /** Where the row is in a hold: pressed and waiting, lifted to drag, or at rest. */
    phase: lifted ? 'lifted' : arming ? 'arming' : 'rest',
    handlers: {
      onPointerDown(event: PointerEvent) {
        cancel();
        held.current = false;
        if (!enabled || !event.isPrimary || event.button !== 0) return;
        const timer = window.setTimeout(() => {
          const start = pending.current?.event;
          pending.current = null;
          if (!start) return;
          stopWatching();
          setArming(false);
          held.current = true;
          moved.current = false;
          setLifted(true);
          controls.start(start);
        }, HOLD_MS);
        pending.current = { timer, x: event.clientX, y: event.clientY, event: event.nativeEvent };
        setArming(true);
      },
      onPointerMove(event: PointerEvent) {
        const press = pending.current;
        if (!press) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) cancel();
        else press.event = event.nativeEvent;
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    },
    /** For the dragged item: its element, its rendered values, and the start of Motion's drag. */
    item: {
      ref: row,
      onUpdate: (latest: ResolvedValues) => {
        const y = latest.y ?? 0;
        offset.current = typeof y === 'number' ? y : Number.parseFloat(y) || 0;
        updated.current = true;
      },
      onDragStart: () => {
        moved.current = true;
      },
    },
    /** True for the click that ends a held press; a plain click answers false. */
    consumeHold() {
      const was = held.current;
      held.current = false;
      return was;
    },
  };
}
