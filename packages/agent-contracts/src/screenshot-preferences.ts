import { Type } from 'typebox';

/**
 * What clicking Done (✓ / Return) in long screenshot does: open the result card (`card`, the
 * default), or close the capture and copy the stitched image directly to the clipboard (`copy`).
 */
export const LONG_SCREENSHOT_CONFIRM_ACTIONS = ['card', 'copy'] as const;
export type LongScreenshotConfirmAction = (typeof LONG_SCREENSHOT_CONFIRM_ACTIONS)[number];
export const LongScreenshotConfirmActionSchema = Type.Union([
  Type.Literal('card'),
  Type.Literal('copy'),
]);

/** Copy the screenshot to the clipboard as well when confirming it to the composer. */
export const DEFAULT_SCREENSHOT_COPY_ON_CONFIRM = true;

/** Default long-screenshot Done action: open the result card. */
export const DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION: LongScreenshotConfirmAction = 'card';
