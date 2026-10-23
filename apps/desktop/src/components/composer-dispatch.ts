import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { canAnimate, smoothSpring } from '../lib/spring-timing';
import { drawnRadius } from './composer-content';

/**
 * A new chat's send as the composer shows it (`useNewChat`). While the send is out, a still copy
 * (`MessageFlight`) covers the editor's `hidden` text inside the unchanged surface. Once accepted,
 * the copy fades in place. Only after it disappears does the surface ease from the captured
 * shape (`from`) to the empty pill.
 */
export interface ComposerDispatch {
  hidden: boolean;
  /** Keep the captured shape until MessageFlight confirms its draft is invisible. */
  holding: boolean;
  from: { height: number; radius: number };
}

/** The glass changes shape on the smooth spring, a little quicker than the message's flight. */
const MORPH = smoothSpring(0.35);

/**
 * The surface's attributes during a dispatch, and its shape change: liquid glass morphs rather than
 * jumping, so the height and the corner radius move together on one spring, from the shape the
 * send found to the pill's. An interruption resumes from the shape currently drawn. Under Reduce
 * Motion the shape changes at once after the draft fades.
 */
export function useComposerDispatch(dispatch: ComposerDispatch | null, expanded: boolean) {
  const surface = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;
  /** The shape the surface last took for a dispatch, which the way back starts from. */
  const pill = useRef<{ height: number; radius: number } | null>(null);
  /** The shape change under way, which a change the other way picks up from where it is. */
  const morph = useRef<Animation | null>(null);
  const held = useRef(false);
  // Keep the glass around the captured draft until the send is accepted. Shrinking it while
  // waiting leaves the still-visible lines floating above the surface.
  const from = dispatch && !dispatch.hidden ? dispatch.from : null;
  const active = from !== null;
  const holding = active && dispatch?.holding;
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    // A dispatch ending while the glass is still shrinking resumes from its current shape.
    let current: { height: number; radius: number } | null = null;
    if (held.current || morph.current?.playState === 'running') {
      const height = element.getBoundingClientRect().height;
      current = { height, radius: drawnRadius(element, height) };
    }
    morph.current?.cancel();
    morph.current = null;
    held.current = false;
    element.style.height = '';
    element.style.borderRadius = '';
    delete element.dataset.morphing;
    element.style.alignContent = '';
    element.style.overflow = '';
    const height = element.getBoundingClientRect().height;
    const end = { height, radius: drawnRadius(element, height) };
    // Once each way per dispatch: from the shape the send found to the pill, and from the pill to
    // the composer's current shape when the dispatch ends. A setting changing midway moves nothing.
    const start = current ?? (from ? (pill.current ? null : from) : pill.current);
    pill.current = from ? end : null;
    // Acceptance clears the live editor before the captured draft finishes fading. Hold its
    // original surface even when the destination takes another render to mount; elapsed time
    // since acceptance does not tell us whether the draft is invisible yet.
    if (from && holding) {
      element.style.height = `${from.height}px`;
      element.style.borderRadius = `${from.radius}px`;
      element.style.alignContent = 'end';
      element.style.overflow = 'hidden';
      held.current = true;
      return;
    }
    if (!start || reduced || !canAnimate(element) || Math.abs(start.height - end.height) < 1)
      return;
    // While the shape changes the content keeps to the surface's bottom edge, where the attach and
    // send buttons sit in both layouts, so they hold still as the glass grows or shrinks above them,
    // and nothing shows past the glass. Set as styles, not keyframes: engines differ on animating
    // discrete properties.
    element.style.alignContent = 'end';
    element.style.overflow = 'hidden';
    // The placeholder cannot return while a resumed/interrupted morph still moves its surface.
    element.dataset.morphing = '';
    const animation = element.animate(
      [
        { height: `${start.height}px`, borderRadius: `${start.radius}px` },
        { height: `${end.height}px`, borderRadius: `${end.radius}px` },
      ],
      MORPH,
    );
    morph.current = animation;
    const release = () => {
      if (morph.current !== animation) return;
      morph.current = null;
      delete element.dataset.morphing;
      element.style.alignContent = '';
      element.style.overflow = '';
    };
    void animation.finished.then(release, release);
  }, [from, holding, reduced]);
  return {
    ref: surface,
    'data-expanded': expanded && !active,
    'data-dispatching': (dispatch?.hidden ?? false) || undefined,
    'data-settling': (active && !dispatch?.hidden) || undefined,
  };
}
