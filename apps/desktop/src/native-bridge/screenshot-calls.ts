import { Type } from 'typebox';
import { Empty } from './primitives.ts';
import { NativeFileRefSchema } from './file-calls.ts';

/** What `screenshot.capture` and `screenshot.edit` answer. */
const ScreenshotResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      file: NativeFileRefSchema,
      context: Type.Union([NativeFileRefSchema, Type.Null()]),
      capturedAt: Type.String({ maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: Type.Union([Type.Literal('cancelled'), Type.Literal('notPermitted')]),
    },
    { additionalProperties: false },
  ),
]);

export const NativeScreenshotCalls = {
  /**
   * Lets the user capture an area, a window or the screen on the native capture overlay (element
   * detection, annotation), with the panel out of the way, and imports the image through
   * `/v1/resources/import`. The panel's visibility is restored afterwards. `context` is a Markdown
   * attachment imported beside the image (app and window, the picked interface element,
   * recognised text), or null when there is nothing to say. `notPermitted`: Screen Recording is
   * not granted (Swift asks once per launch); `cancelled`: the user dismissed the capture. An
   * import the service refuses rejects with its message.
   */
  'screenshot.capture': { params: Empty, result: ScreenshotResultSchema },
  /**
   * Opens an image attachment (`resourceId`, an image resource) on the capture overlay for more
   * annotation and cropping, and imports the result as a new resource; the original is left as it
   * is. A capture taken during this app run reopens with its annotations still editable; any other
   * image is annotated on top of its pixels. `context` is always null (the caller keeps any context
   * it had); `cancelled` leaves the attachment unchanged.
   */
  'screenshot.edit': {
    params: Type.Object(
      { resourceId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }) },
      { additionalProperties: false },
    ),
    result: ScreenshotResultSchema,
  },
};
