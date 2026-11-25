import type { HudMover, Velocity } from './mover.ts';
import { HOME, anchorAt } from './position.ts';

/** Where a press starts no drag: the capsule's controls stay clickable and the field editable. */
const CONTROLS = 'button, textarea, input, select, a, [data-control]';
/** Movement under this (px) is still a click. */
const DRAG_SLOP = 4;
/** UIKit's normal deceleration: the projected resting point decides the anchor, not the release. */
const PROJECTION_MS = 499;
/** Keeps the capsule this far inside the viewport while it follows the pointer. */
const EDGE = 8;

interface Sample {
  t: number;
  x: number;
  y: number;
}

function onControl(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && target.closest(CONTROLS) !== null;
}

/**
 * The HUD follows the pointer 1:1, then springs to the anchor its momentum points at (the
 * prototype's `wireHudDrag`). A drag starts only off the controls and after a few pixels; the
 * click that ends it is swallowed. Double-click off the controls returns it to its default place.
 */
export function wireDrag(capsule: HTMLElement, mover: HudMover, onMove: () => void): void {
  let pointerId: number | null = null;
  let start = { x: 0, y: 0 };
  let base = { left: 0, top: 0, right: 0, bottom: 0 };
  let started = false;
  let samples: Sample[] = [];
  let swallowClick = false;

  capsule.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || onControl(event)) return;
    // A grab during the glide continues from where the HUD is drawn, not from its anchor.
    const offset = mover.takeGlide();
    const rect = capsule.getBoundingClientRect();
    pointerId = event.pointerId;
    start = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    started = offset.x !== 0 || offset.y !== 0;
    samples = [{ t: event.timeStamp, x: event.clientX, y: event.clientY }];
    base = {
      left: rect.left - offset.x,
      top: rect.top - offset.y,
      right: rect.right - offset.x,
      bottom: rect.bottom - offset.y,
    };
    try {
      capsule.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks.
    }
  });

  // Keeps a drag from selecting page text; presses on the field and controls keep their default.
  capsule.addEventListener('mousedown', (event) => {
    if (!onControl(event)) event.preventDefault();
  });

  capsule.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    let dx = event.clientX - start.x;
    let dy = event.clientY - start.y;
    if (!started) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      started = true;
    }
    capsule.classList.add('dragging');
    dx = Math.min(Math.max(dx, EDGE - base.left), innerWidth - EDGE - base.right);
    dy = Math.min(Math.max(dy, EDGE - base.top), innerHeight - EDGE - base.bottom);
    capsule.style.setProperty('transform', `translate(${dx}px, ${dy}px)`);
    samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    while (samples.length > 2 && event.timeStamp - (samples[0]?.t ?? 0) > 100) samples.shift();
    onMove();
  });

  const end = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    capsule.classList.remove('dragging');
    if (!started) return;
    started = false;
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    }, 0);
    mover.move(restingAnchor(capsule, samples), releaseVelocity(samples));
  };
  capsule.addEventListener('pointerup', end);
  capsule.addEventListener('pointercancel', end);
  capsule.addEventListener('lostpointercapture', end);

  capsule.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    true,
  );

  capsule.addEventListener('dblclick', (event) => {
    if (!onControl(event)) mover.move(HOME);
  });
}

function releaseVelocity(samples: readonly Sample[]): Velocity {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return { x: 0, y: 0 };
  const dt = last.t - first.t;
  return dt > 10 ? { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt } : { x: 0, y: 0 };
}

function restingAnchor(capsule: HTMLElement, samples: readonly Sample[]) {
  const velocity = releaseVelocity(samples);
  const rect = capsule.getBoundingClientRect();
  return anchorAt(
    rect.left + rect.width / 2 + velocity.x * PROJECTION_MS,
    rect.top + rect.height / 2 + velocity.y * PROJECTION_MS,
    innerWidth,
    innerHeight,
  );
}
