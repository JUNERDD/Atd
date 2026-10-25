import { Type } from 'typebox';
import { Empty } from './primitives.ts';

export const NativeShortcutRecordingCalls = {
  /**
   * Suspends this app's global shortcuts for one recorder in the calling document. The start
   * resolves only after native listeners are removed; ending another session cannot resume it.
   * The shell also releases the document's sessions when it loses focus, unloads or closes.
   */
  'shortcuts.recording': {
    params: Type.Object(
      { session: Type.Integer({ minimum: 1 }), active: Type.Boolean() },
      { additionalProperties: false },
    ),
    result: Empty,
  },
};

export const NativeShortcutRecordingEvents = {
  /** Global registrations resumed; the panel refreshes their actual registration results. */
  'shortcuts.changed': Empty,
};
