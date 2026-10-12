import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_COMMAND_TYPING,
  DEFAULT_SHORTCUTS,
  parse,
  parseShortcutBindings,
  UserSettingsSchema,
  type ShortcutBindingsWire,
  type PatchSettingsRequest,
  type PermissionTier,
  type SelectionToolbarSettings,
  type SettingsResponse,
  type UserSettings,
} from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { atomicWrite } from '../config.js';
import { setUserShellAllowlist } from '../shell-policy.js';

const SettingsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    revision: Type.Integer({ minimum: 1 }),
    /** False while only the legacy allowlist push has written; see `replaceShellAllowlist`. */
    initialized: Type.Boolean(),
    settings: UserSettingsSchema,
  },
  { additionalProperties: false },
);

function settingsFile(root: string): string {
  return path.join(root, 'settings.json');
}

/** The stored settings file, or null while no client has written one. */
async function readStored(file: string): Promise<Static<typeof SettingsFileSchema> | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  return parse(
    SettingsFileSchema,
    withAddedCommandTypingAnimation(
      withAddedCommandTyping(
        withAddedOnboarding(withAddedSelectionToolbar(withAddedShortcuts(JSON.parse(raw)))),
      ),
    ),
  );
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

/**
 * The fields `request` writes, with the typing animation turned on alongside the typing effect's
 * first turn-on: while the animation was never chosen (`previous` null) and the request does not
 * choose it, turning typing on takes the animation with it. A user who chose the animation, on or
 * off, keeps the choice.
 */
export function withFirstTypingAnimation(
  previous: Pick<UserSettings, 'commandTyping' | 'commandTypingAnimation'>,
  fields: Omit<PatchSettingsRequest, 'onlyIfUninitialized'>,
): Omit<PatchSettingsRequest, 'onlyIfUninitialized'> {
  const turnsTypingOn = fields.commandTyping === true && !previous.commandTyping;
  if (!turnsTypingOn || previous.commandTypingAnimation !== null) return fields;
  if (fields.commandTypingAnimation !== undefined) return fields;
  return { ...fields, commandTypingAnimation: true };
}

/** The selection toolbar starts on, over every app, for selections made while Option is held. */
const DEFAULT_SELECTION_TOOLBAR: SelectionToolbarSettings = {
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

/** The settings a shortcut can collide with: the application bindings and the toolbar's gesture. */
export interface ShortcutHolders {
  shortcuts: ShortcutBindingsWire;
  selectionToolbar: SelectionToolbarSettings;
}

/** The holders in effect for `settings`, null bindings reading as the defaults. */
function shortcutHolders(
  settings: Pick<UserSettings, 'shortcuts' | 'selectionToolbar'>,
): ShortcutHolders {
  return {
    shortcuts: settings.shortcuts ?? DEFAULT_SHORTCUTS,
    selectionToolbar: settings.selectionToolbar,
  };
}

/**
 * The user settings every client shares (`settings.json` in the data dir). A missing file means
 * no client has written settings yet: the store answers defaults with `initialized: false`, so
 * the first desktop client can seed it from the settings it kept before the service owned them.
 * The shell policy mirrors the stored allowlist on load and on every write.
 */
export class SettingsStore {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private state: SettingsResponse,
  ) {
    setUserShellAllowlist(state.settings.shellAllowlist);
  }

  /** `defaultTier` is the operator's `--tier`, the new-task tier until a client picks one. */
  static async load(root: string, defaultTier: PermissionTier): Promise<SettingsStore> {
    const file = settingsFile(root);
    const stored = await readStored(file);
    if (!stored) {
      const settings: UserSettings = {
        language: null,
        permissionTier: defaultTier,
        shellAllowlist: [],
        shortcuts: null,
        selectionToolbar: structuredClone(DEFAULT_SELECTION_TOOLBAR),
        commandTyping: DEFAULT_COMMAND_TYPING,
        commandTypingAnimation: null,
        onboardingCompleted: false,
        onboardingProgress: null,
      };
      return new SettingsStore(file, { settings, revision: 0, initialized: false });
    }
    return new SettingsStore(file, {
      settings: stored.settings,
      revision: stored.revision,
      initialized: stored.initialized,
    });
  }

  /**
   * What a command shortcut can collide with in the settings: the application shortcuts and the
   * selection toolbar's activation in effect, read from the file the live store writes
   * atomically, for callers that load stores per call (the Agent's `command` tool) and hold no
   * instance.
   */
  static async readShortcutHolders(root: string): Promise<ShortcutHolders> {
    const settings = (await readStored(settingsFile(root)))?.settings;
    return settings
      ? shortcutHolders(settings)
      : { shortcuts: DEFAULT_SHORTCUTS, selectionToolbar: DEFAULT_SELECTION_TOOLBAR };
  }

  current(): SettingsResponse {
    return structuredClone(this.state);
  }

  /** Tier a task created now freezes. */
  newTaskTier(): PermissionTier {
    return this.state.settings.permissionTier;
  }

  /**
   * Applies a settings patch. Application bindings it sets are validated for this machine's
   * platform (the desktop there registers them) and stored canonical. A patch that sets the
   * bindings or the selection toolbar, whose `toggle` gesture can hold a double-tap, then has
   * `checkShortcuts` see both as in effect before and after it, inside the write order; it throws
   * to refuse.
   */
  patch(
    request: PatchSettingsRequest,
    checkShortcuts: (next: ShortcutHolders, previous: ShortcutHolders) => Promise<void>,
  ): Promise<SettingsResponse> {
    return this.serialize(async () => {
      if (request.onlyIfUninitialized && this.state.initialized) return this.current();
      const { onlyIfUninitialized: _seed, ...fields } = request;
      void _seed;
      if (fields.shortcuts)
        fields.shortcuts = parseShortcutBindings(fields.shortcuts, process.platform);
      if (fields.shortcuts !== undefined || fields.selectionToolbar !== undefined)
        await checkShortcuts(
          shortcutHolders({ ...this.state.settings, ...fields }),
          shortcutHolders(this.state.settings),
        );
      return this.write(
        { ...this.state.settings, ...withFirstTypingAnimation(this.state.settings, fields) },
        true,
      );
    });
  }

  /**
   * `PUT /v1/settings/shell-allowlist`, which desktop builds from before the service owned
   * settings send on every connection. It persists the list but leaves `initialized` as it was,
   * so the one-time seed of the other settings still runs.
   */
  replaceShellAllowlist(entries: string[]): Promise<SettingsResponse> {
    return this.serialize(() =>
      this.write({ ...this.state.settings, shellAllowlist: entries }, this.state.initialized),
    );
  }

  /** Writes are serialized so concurrent clients cannot interleave a read-modify-write. */
  private serialize(action: () => Promise<SettingsResponse> | SettingsResponse) {
    const pending = this.chain.then(action);
    this.chain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async write(next: UserSettings, initialized: boolean): Promise<SettingsResponse> {
    const settings = parse(UserSettingsSchema, next);
    const revision = this.state.revision + 1;
    await atomicWrite(this.file, { version: 1, revision, initialized, settings });
    this.state = { settings, revision, initialized };
    setUserShellAllowlist(settings.shellAllowlist);
    return this.current();
  }
}
