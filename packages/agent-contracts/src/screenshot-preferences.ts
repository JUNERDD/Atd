import { Type } from 'typebox';

/**
 * What clicking Done (✓ / Return) in long screenshot does: open the result card (`card`, the
 * default), close the capture and copy the stitched image directly to the clipboard (`copy`), or
 * save it directly to the configured folder and close (`save`).
 */
export const LONG_SCREENSHOT_CONFIRM_ACTIONS = ['card', 'copy', 'save'] as const;
export type LongScreenshotConfirmAction = (typeof LONG_SCREENSHOT_CONFIRM_ACTIONS)[number];
export const LongScreenshotConfirmActionSchema = Type.Union([
  Type.Literal('card'),
  Type.Literal('copy'),
  Type.Literal('save'),
]);

/**
 * What clicking ✓, pressing Return, or double-clicking a screenshot selection on the toolbar
 * does: open the main panel and attach to the composer while copying to the clipboard
 * (`attachAndCopy`, the default), open the main panel and attach to the composer only (`attach`),
 * or copy to the clipboard without opening the main panel (`copy`).
 */
export const SCREENSHOT_CONFIRM_ACTIONS = ['attachAndCopy', 'attach', 'copy'] as const;
export type ScreenshotConfirmAction = (typeof SCREENSHOT_CONFIRM_ACTIONS)[number];
export const ScreenshotConfirmActionSchema = Type.Union([
  Type.Literal('attachAndCopy'),
  Type.Literal('attach'),
  Type.Literal('copy'),
]);

/** Default screenshot confirmation action: attach to the composer and copy to the clipboard. */
export const DEFAULT_SCREENSHOT_CONFIRM_ACTION: ScreenshotConfirmAction = 'attachAndCopy';

/**
 * Whether `screenshotConfirmAction` also applies when confirming a screenshot started from the
 * composer's "+ › Screenshot" menu; false keeps ✓ attaching to the current composer.
 */
export const DEFAULT_SCREENSHOT_CONFIRM_IN_COMPOSER = false;

/** Default long-screenshot Done action: open the result card. */
export const DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION: LongScreenshotConfirmAction = 'card';
