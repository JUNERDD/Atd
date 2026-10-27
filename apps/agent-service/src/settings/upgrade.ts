import {
  DEFAULT_COMMAND_TYPING,
  DEFAULT_SHORTCUTS,
  DEFAULT_SUMMARY_TITLES,
  DEFAULT_VIEW_INITIATIVE,
  type SelectionToolbarSettings,
} from '@atd/agent-contracts';

/**
 * Read-side upgrades of a settings file written by an older build: each fills in what that build
 * did not store, so the strict parse in `readStoredSettings` (store.ts) accepts it. The next write
 * stores every field.
 */
export function upgradeSettingsFile(raw: unknown): unknown {
  return withAddedTaskPreferences(
    withAddedVisionModel(
      withAddedAppearance(
        withAddedCommandTypingAnimation(
          withAddedCommandTyping(
            withAddedOnboarding(withAddedSelectionToolbar(withAddedShortcuts(raw))),
          ),
        ),
      ),
    ),
  );
}

/** Older settings take the defaults for view initiative and new-conversation summaries. */
function withAddedTaskPreferences(file: unknown): unknown {
  if (typeof file !== 'object' || file === null || !('settings' in file)) return file;
  const { settings } = file;
  if (typeof settings !== 'object' || settings === null) return file;
  const defaults = {
    viewInitiative: DEFAULT_VIEW_INITIATIVE,
    summaryTitles: DEFAULT_SUMMARY_TITLES,
  };
  return { ...file, settings: { ...defaults, ...settings } };
}

/** Old settings follow the task model without selecting another connection. */
function withAddedVisionModel(file: unknown): unknown {
  if (typeof file !== 'object' || file === null || !('settings' in file)) return file;
  const { settings } = file;
  if (typeof settings !== 'object' || settings === null) return file;
  return { ...file, settings: { computerVisionModel: null, ...settings } };
}

/** A file written before the appearance setting existed follows the system. */
function withAddedAppearance(file: unknown): unknown {
  if (typeof file !== 'object' || file === null || !('settings' in file)) return file;
  const { settings } = file;
  if (typeof settings !== 'object' || settings === null) return file;
  return { ...file, settings: { appearance: null, ...settings } };
}

/**
 * A file written before the welcome guide existed belongs to someone already using the app, so it
 * keeps the guide dismissed. Files without saved progress keep their existing completion flag.
 * Progress saved before the music toggle was kept resumes with the music on.
 */
function withAddedOnboarding(file: unknown): unknown {
  if (typeof file !== 'object' || file === null || !('settings' in file)) return file;
  const { settings } = file;
  if (typeof settings !== 'object' || settings === null) return file;
  const progress = 'onboardingProgress' in settings ? settings.onboardingProgress : null;
  return {
    ...file,
    settings: {
      onboardingCompleted: true,
      onboardingProgress: null,
      ...settings,
      ...(typeof progress === 'object' && progress !== null
        ? { onboardingProgress: { musicMuted: false, ...progress } }
        : {}),
    },
  };
}

/**
 * A file written before the typing setting existed reads with its default. One written while it
 * chose a rate (`instant`, `slow`, `normal` or `fast`) keeps typing for every rate and pastes at
 * once for `instant`; any other value that is not a switch reads as the default.
 */
function withAddedCommandTyping(file: unknown): unknown {
  if (typeof file !== 'object' || file === null || !('settings' in file)) return file;
  const { settings } = file;
  if (typeof settings !== 'object' || settings === null) return file;
  const stored = 'commandTyping' in settings ? settings.commandTyping : undefined;
  const commandTyping =
    typeof stored === 'boolean' ? stored : stored === 'instant' ? false : DEFAULT_COMMAND_TYPING;
  return { ...file, settings: { ...settings, commandTyping } };
}

/**
 * A file written before the typing animation setting existed reads as never chosen; so does a
 * stored value that is not a switch.
 */
function withAddedCommandTypingAnimation(file: unknown): unknown {
  if (typeof file !== 'object' || file === null || !('settings' in file)) return file;
  const { settings } = file;
  if (typeof settings !== 'object' || settings === null) return file;
  const stored = 'commandTypingAnimation' in settings ? settings.commandTypingAnimation : undefined;
  const commandTypingAnimation = typeof stored === 'boolean' ? stored : null;
  return { ...file, settings: { ...settings, commandTypingAnimation } };
}

/** The selection toolbar starts on, over every app, for selections made while Option is held. */
export const DEFAULT_SELECTION_TOOLBAR: SelectionToolbarSettings = {
  enabled: true,
  excludedApps: [],
  activation: 'hold',
  activationKeys: ['option'],
  showHud: true,
};

/**
 * A file written before the selection toolbar existed reads with its default; one written before
 * its activation existed keeps its switch and apps and takes the default activation. A single
 * `activationKey`, which development builds briefly stored, becomes a one-key combination.
 */
function withAddedSelectionToolbar(file: unknown): unknown {
  if (typeof file !== 'object' || file === null || !('settings' in file)) return file;
  const { settings } = file;
  if (typeof settings !== 'object' || settings === null) return file;
  const stored = 'selectionToolbar' in settings ? settings.selectionToolbar : {};
  if (typeof stored !== 'object' || stored === null) return file;
  const { activationKey, ...rest } = stored as Record<string, unknown>;
  const selectionToolbar = {
    ...DEFAULT_SELECTION_TOOLBAR,
    ...(activationKey === undefined ? {} : { activationKeys: [activationKey] }),
    ...rest,
  };
  return { ...file, settings: { ...settings, selectionToolbar } };
}

/**
 * A file written before an application shortcut action existed (`captureScreenshot`) stores
 * bindings without it; the missing actions take their defaults, so the file still reads and the
 * next write stores every action.
 */
function withAddedShortcuts(file: unknown): unknown {
  if (typeof file !== 'object' || file === null || !('settings' in file)) return file;
  const { settings } = file;
  if (typeof settings !== 'object' || settings === null || !('shortcuts' in settings)) return file;
  const { shortcuts } = settings;
  if (typeof shortcuts !== 'object' || shortcuts === null) return file;
  return { ...file, settings: { ...settings, shortcuts: { ...DEFAULT_SHORTCUTS, ...shortcuts } } };
}
