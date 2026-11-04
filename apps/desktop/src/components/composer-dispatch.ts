import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { canAnimate, smoothSpring } from '../lib/spring-timing';
import { drawnRadius } from './composer-content';

/**
 * A new chat's send as the composer shows it (`useNewChat`). From the moment Send is pressed a
 * still copy (`MessageFlight`) fades over the editor's text, `hidden` while the send is out and
 * cleared once it opens its conversation. The surface then eases at once from the captured shape
 * (`from`) to the empty pill; the copy keeps within the glass as its top edge comes down.
 */
export interface ComposerDispatch {
  hidden: boolean;
  /** The copy still shows over the editor, so the empty editor's placeholder stays hidden. */
  covered: boolean;
  from: { height: number; radius: number };
}

/** The glass changes shape on a smooth spring as the sent draft leaves it. */
const MORPH = smoothSpring(0.35);

/**
 * The surface's attributes during a dispatch, and its shape change: liquid glass morphs rather than
 * jumping, so the height and the corner radius move together on one spring, from the shape the
 * send found to the pill's. An interruption resumes from the shape currently drawn. Under Reduce
 * Motion the shape changes at once.
 */
export function useComposerDispatch(dispatch: ComposerDispatch | null, expanded: boolean) {
  const surface = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;
  /** The shape the surface last took for a dispatch, which the way back starts from. */
  const pill = useRef<{ height: number; radius: number } | null>(null);
  /** The shape change under way, which a change the other way picks up from where it is. */
  const morph = useRef<Animation | null>(null);
  // The glass keeps around the captured draft while the send is out, and leaves it as soon as the
  // send opens its conversation.
  const from = dispatch && !dispatch.hidden ? dispatch.from : null;
  const expandedLayout = expanded && from === null;
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    // Page arrival does not change an empty composer's destination. Let its existing spring
    // finish instead of starting another full spring for the last few pixels.
    if (
      !from &&
      !expandedLayout &&
      pill.current &&
      morph.current?.playState === 'running' &&
      !reduced
    ) {
      pill.current = null;
      return;
    }
    // A changed destination, such as a newly expanded draft, resumes from the current shape.
    let current: { height: number; radius: number } | null = null;
    if (morph.current?.playState === 'running') {
      const height = element.getBoundingClientRect().height;
      current = { height, radius: drawnRadius(element, height) };
    }
    morph.current?.cancel();
    morph.current = null;
    element.style.alignContent = '';
    element.style.overflow = '';
    const height = element.getBoundingClientRect().height;
    const end = { height, radius: drawnRadius(element, height) };
    // Once each way per dispatch: from the shape the send found to the pill, and from the pill to
    // the composer's current shape when the dispatch ends. A setting changing midway moves nothing.
    const start = current ?? (from ? (pill.current ? null : from) : pill.current);
    pill.current = from ? end : null;
    if (!start || reduced || !canAnimate(element) || Math.abs(start.height - end.height) < 1)
      return;
    // While the shape changes the content keeps to the surface's bottom edge, where the attach and
    // send buttons sit in both layouts, so they hold still as the glass grows or shrinks above them,
    // and nothing shows past the glass. Set as styles, not keyframes: engines differ on animating
    // discrete properties.
    element.style.alignContent = 'end';
    element.style.overflow = 'hidden';
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
      element.style.alignContent = '';
      element.style.overflow = '';
    };
    void animation.finished.then(release, release);
  }, [from, reduced, expandedLayout]);
  return {
    ref: surface,
    'data-expanded': expandedLayout,
    'data-dispatching': (dispatch?.hidden ?? false) || undefined,
    'data-placeholder-held': dispatch?.hidden || dispatch?.covered || undefined,
  };
}
