import { Type, type Static } from 'typebox';
import { ComputerRefIdSchema } from './computer-actions.js';

/**
 * Capture geometry of an observation: what one screenshot shows and how its pixels map back to
 * the window, the recognized text boxes on it, and the problems that keep the tree and the image
 * from being trusted together. Pixel ("px") values are pixels of one capture image; point ("pt")
 * values are screen points (Quartz, top-left origin, y down). The host keeps the authoritative
 * mapping and recomputes it before acting on a capture point.
 */

/** Text boxes one observation reports. */
export const COMPUTER_MAX_TEXT_BOXES = 200;

/** A rectangle in the coordinate space its owner names. */
export const ComputerRectSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ComputerRect = Static<typeof ComputerRectSchema>;

/**
 * One screenshot of a surface. `width` × `height` are its pixels; `scale` is pixels per point;
 * `frame` is the window's frame in points when it was captured; `crop`, when set, is the captured
 * part in points relative to `frame`'s origin (a region observe).
 */
export const ComputerCaptureSchema = Type.Object(
  {
    id: ComputerRefIdSchema,
    surfaceRefId: Type.Optional(ComputerRefIdSchema),
    mime: Type.Union([Type.Literal('image/png'), Type.Literal('image/jpeg')]),
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    scale: Type.Number({ exclusiveMinimum: 0 }),
    frame: ComputerRectSchema,
    crop: Type.Optional(ComputerRectSchema),
    capturedAt: Type.String(),
    expiresAt: Type.Optional(
      Type.String({
        description:
          'Conservative host use-by deadline for capture points, not the exact driver expiry. Observe again and relocate after it passes; never replay old coordinates.',
      }),
    ),
  },
  { additionalProperties: false },
);
export type ComputerCapture = Static<typeof ComputerCaptureSchema>;

/** Text the host recognized on a capture; `rect` is in pixels of that capture. */
export const ComputerTextBoxSchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 500 }),
    rect: ComputerRectSchema,
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  },
  { additionalProperties: false },
);
export type ComputerTextBox = Static<typeof ComputerTextBoxSchema>;

/**
 * Why part of an observation cannot be relied on: the accessibility tree is empty or was cut
 * short, no screenshot could be taken or its window frame is unusable, text recognition failed,
 * or the tree and the image disagree (observe again before acting). Each is reported on its own;
 * one source working never proves the other right.
 */
export const ComputerObservationProblemSchema = Type.Union([
  Type.Literal('treeEmpty'),
  Type.Literal('treeTruncated'),
  Type.Literal('screenshotUnavailable'),
  Type.Literal('screenshotFrameInvalid'),
  Type.Literal('textUnavailable'),
  Type.Literal('treeImageConflict'),
]);
export type ComputerObservationProblem = Static<typeof ComputerObservationProblemSchema>;

/**
 * What one `observe` collects. At least one of `tree` and `screenshot` is true (the service
 * enforces it; a host refuses otherwise with `unsupported`), and `text` requires `screenshot`.
 */
export const ComputerObserveIncludeSchema = Type.Object(
  { tree: Type.Boolean(), screenshot: Type.Boolean(), text: Type.Boolean() },
  { additionalProperties: false },
);
export type ComputerObserveInclude = Static<typeof ComputerObserveIncludeSchema>;

/**
 * A part of an earlier capture to observe again: `rect` in pixels of capture `capture`. The host
 * recaptures and crops the same window area rather than reusing the old image.
 */
export const ComputerObserveRegionSchema = Type.Object(
  { capture: ComputerRefIdSchema, rect: ComputerRectSchema },
  { additionalProperties: false },
);
export type ComputerObserveRegion = Static<typeof ComputerObserveRegionSchema>;
