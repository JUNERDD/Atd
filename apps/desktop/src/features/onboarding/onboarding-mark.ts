import { createContext } from 'react';

/**
 * The shared-layout id of page one's mark (`AppMark` in `art-welcome.tsx`): the intro's copy and
 * the Welcome art's copy carry it, so at the reveal the intro's mark travels into the Welcome
 * step's display area.
 */
export const MARK_LAYOUT_ID = 'onboarding-mark';

/**
 * Whether the intro is handing its mark to the card right now (the timed reveal, without Reduce
 * Motion). The Welcome art reads it once, when it mounts: only that first mount takes over the
 * intro's mark; after a skip, under Reduce Motion, or coming back to the step the mark is at rest.
 */
export const MarkHandoffContext = createContext(false);
