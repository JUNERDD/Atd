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

/** Copy the screenshot to the clipboard as well when confirming it to the composer. */
export const DEFAULT_SCREENSHOT_COPY_ON_CONFIRM = true;

/** Default long-screenshot Done action: open the result card. */
export const DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION: LongScreenshotConfirmAction = 'card';
