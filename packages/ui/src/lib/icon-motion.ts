import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

export interface IconMotionTrack {
  /** Selects parts inside the supplied SVG, never elsewhere on the page. */
  selector: string;
  keyframes: Keyframe[];
  /** Animate a temporary copy with pathLength=1, keeping the original outline visible. */
  layer?: 'overlay';
  /** Milliseconds; all tracks start together and play once. */
  duration?: number;
  /** Segment easing; keyframe offsets remain literal positions on the gesture's timeline. */
  easing?: string;
  origin?: string;
  /** Keep the end pose until cancelled, including after playback finishes. */
  hold?: boolean;
}

export type IconMotion = readonly IconMotionTrack[];

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const isReducedMotion = () => window.matchMedia(reducedMotionQuery).matches;
const serverReducedMotion = () => true;

function subscribeReducedMotion(change: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

function playIconMotion(icon: SVGSVGElement, motion: IconMotion) {
  const overflow = icon.style.overflow;
  const transformBoxes = new Map<SVGElement, string>();
  const overlays: SVGElement[] = [];
  // Resolve before inserting overlays: nth-child and last-child address the original geometry.
  const tracks = motion.map((track) => ({
    ...track,
    parts: [...icon.querySelectorAll<SVGElement>(track.selector)],
  }));
  // The gesture may extend beyond the viewBox without moving the SVG's layout box.
  icon.style.overflow = 'visible';
  const animations = tracks.flatMap(
    ({
      parts,
      keyframes,
      layer,
      duration = 480,
      easing = 'cubic-bezier(0.2, 0, 0, 1)',
      origin = 'center',
      hold = false,
    }) =>
      parts.map((source) => {
        let part = source;
        if (layer === 'overlay') {
          const copy = source.cloneNode(false);
          if (!(copy instanceof SVGElement)) throw new TypeError('Expected an SVG icon part');
          copy.removeAttribute('id');
          copy.setAttribute('pathLength', '1');
          copy.setAttribute('fill', 'none');
          copy.setAttribute('aria-hidden', 'true');
          copy.style.pointerEvents = 'none';
          icon.append(copy);
          overlays.push(copy);
          part = copy;
        }
        if (!transformBoxes.has(part)) transformBoxes.set(part, part.style.transformBox);
        part.style.transformBox = 'fill-box';
        const animation = part.animate(
          keyframes.map((frame) => ({ transformOrigin: origin, easing, ...frame })),
          { duration, fill: hold ? 'forwards' : 'none' },
        );
        if (layer === 'overlay' && !hold) {
          animation.addEventListener('finish', () => part.remove(), { once: true });
        }
        return animation;
      }),
  );

  return () => {
    // Keep the SVG's original attributes authoritative; never commit the animated styles.
    for (const animation of animations) animation.cancel();
    for (const overlay of overlays) overlay.remove();
    for (const [part, transformBox] of transformBoxes) part.style.transformBox = transformBox;
    icon.style.overflow = overflow;
  };
}

/**
 * Controls one active icon gesture. The caller decides when to play and explicitly pairs an SVG
 * with its motion. A new play, cancellation, disable, reduced-motion change or unmount restores
 * the previous icon, including held end poses. No hover, focus or mount trigger is installed.
 */
export function useIconMotion({ disabled = false }: { disabled?: boolean } = {}) {
  // Subscribe directly: Motion 14's useReducedMotion reads the preference only at mount.
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    isReducedMotion,
    serverReducedMotion,
  );
  const cleanup = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
  }, []);
  const play = useCallback(
    (icon: SVGSVGElement, motion: IconMotion) => {
      cancel();
      if (disabled || reduced || !icon.isConnected || typeof icon.animate !== 'function') return;
      cleanup.current = playIconMotion(icon, motion);
    },
    [cancel, disabled, reduced],
  );

  useEffect(() => cancel, [cancel, disabled, reduced]);
  return { play, cancel };
}
