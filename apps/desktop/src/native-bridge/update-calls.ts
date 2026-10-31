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
   * result windows; an update already under way, downloading or ready to install, moves into
   * those windows instead. Ignored where `app.about` reports no updates.
   */
  'update.check': Empty,
  /**
   * Installs the update `update.state` reports ready and relaunches, through the app's quit flow
   * (which still asks before stopping running tasks). Ignored while no update is ready.
   */
  'update.install': Empty,
};

/** The update an `update.state` other than `idle` is about, as its appcast displays it. */
const UpdateVersion = Text(64);

export const NativeUpdateEvents = {
  /**
   * Where the app's update stands: `downloading` while Sparkle fetches it (`percent` in whole
   * steps, null while the size is unknown), `preparing` while it unpacks and checks the download,
   * `ready` once it waits to install (on quit, or now through `update.install`), and `idle` while
   * none is under way. Sent to the panel on each change and replayed when its page becomes ready.
   */
  'update.state': Type.Union([
    Type.Object({ phase: Type.Literal('idle') }, { additionalProperties: false }),
    Type.Object(
      {
        phase: Type.Literal('downloading'),
        version: UpdateVersion,
        percent: Type.Union([Type.Integer({ minimum: 0, maximum: 100 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      { phase: Type.Literal('preparing'), version: UpdateVersion },
      { additionalProperties: false },
    ),
    Type.Object(
      { phase: Type.Literal('ready'), version: UpdateVersion },
      { additionalProperties: false },
    ),
  ]),
};
