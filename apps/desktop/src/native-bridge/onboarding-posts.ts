import { Type } from 'typebox';
import { Text } from './primitives.ts';

/** A rectangle the welcome guide reports, in CSS pixels from the web view's top-left. */
const GuideRectSchema = Type.Object(
  {
    x: Type.Number({ minimum: 0 }),
    y: Type.Number({ minimum: 0 }),
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** Longest text `onboarding.selection` takes; the practice area's sample is far shorter. */
export const MAX_PRACTICE_SELECTION_LENGTH = 2000;

export const NativeOnboardingPosts = {
  /**
   * The welcome guide's glass surface in CSS pixels from the web view's top-left, and its corner
   * radius; the shell lays the window material (the panel's and Settings' glass) under it. The
   * opening page sends its whole box (radius 0); the card takes the glass over by sending its own
   * once its entrance is at rest, then on every resize, and `null` once the guide starts closing
   * and on teardown. `fade` is how many seconds the glass takes to fade in when the post shows
   * hidden glass, or out when it is `null` (eased in and out); shown glass moves at once. The
   * shell takes it only from the guide's own web view.
   */
  'onboarding.surface': Type.Object(
    {
      rect: Type.Union([GuideRectSchema, Type.Null()]),
      radius: Type.Number({ minimum: 0 }),
      fade: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  /**
   * The welcome guide's practice selection: the bounding box of text selected in its practice
   * area, in CSS pixels from the web view's top-left, and that text. The shell shows the real
   * selection toolbar beside it (while the toolbar is on and the app is trusted for
   * Accessibility), and its Ask Atd and commands take this text as the selection. `null` hides
   * that toolbar: sent when the selection collapses or leaves the practice text, on a key, a
   * scroll or a step change, once the guide starts closing and on teardown. The shell takes it
   * only from the guide's own web view.
   */
  'onboarding.selection': Type.Object(
    {
      rect: Type.Union([GuideRectSchema, Type.Null()]),
      text: Text(MAX_PRACTICE_SELECTION_LENGTH),
    },
    { additionalProperties: false },
  ),
};
