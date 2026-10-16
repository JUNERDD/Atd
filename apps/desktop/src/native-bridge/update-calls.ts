/**
 * The running app's identity and its updates across the native bridge (`contract.ts`). Release
 * builds update through Sparkle in the shell; Debug builds never update. Like the rest of the
 * contract, the export script loads this file with Node's type stripping, so it imports nothing but
 * TypeBox and its sibling contract files (by their `.ts` names) and uses only erasable TypeScript
 * syntax.
 */
import { Type } from 'typebox';
import { Empty, Text } from './primitives.ts';

export const AppAboutSchema = Type.Object(
  {
    /** The marketing version (`CFBundleShortVersionString`), such as `0.9.0`. */
    version: Text(64),
    /** The build number Sparkle compares (`CFBundleVersion`). */
    build: Text(64),
    /** Whether `update.check` does anything: false in Debug builds, which never update. */
    updates: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const NativeUpdateCalls = {
  /** What the settings window's About page shows about the running app; any window may ask. */
  'app.about': { params: Empty, result: AppAboutSchema },
};

export const NativeUpdatePosts = {
  /**
   * Checks for updates as the app menu's Check for Updates does, with Sparkle's own progress and
   * result windows; a waiting update shows as ready to install. Ignored where `app.about` reports
   * no updates.
   */
  'update.check': Empty,
  /**
   * Installs the update `update.state` names and relaunches, through the app's quit flow (which
   * still asks before stopping running tasks). Ignored while no update waits.
   */
  'update.install': Empty,
};

export const NativeUpdateEvents = {
  /**
   * The version of a downloaded update that installs when the app quits, null while none waits.
   * Sent to the panel on each change and replayed when its page becomes ready.
   */
  'update.state': Type.Object(
    { version: Type.Union([Text(64), Type.Null()]) },
    { additionalProperties: false },
  ),
};
