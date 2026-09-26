import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_SHORTCUTS,
  parse,
  parseShortcutBindings,
  UserSettingsSchema,
  type ShortcutBindingsWire,
  type PatchSettingsRequest,
  type PermissionTier,
  type SettingsResponse,
  type UserSettings,
} from '@ai/agent-contracts';
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
  return parse(SettingsFileSchema, JSON.parse(raw));
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
   * The application shortcuts in effect, read from the file the live store writes atomically:
   * for callers that load stores per call (the Agent's `command` tool) and hold no instance.
   */
  static async readShortcuts(root: string): Promise<ShortcutBindingsWire> {
    return (await readStored(settingsFile(root)))?.settings.shortcuts ?? DEFAULT_SHORTCUTS;
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
   * platform (the desktop there registers them) and stored canonical; `checkShortcuts` then sees
   * the bindings in effect before and after, inside the write order, and throws to refuse.
   */
  patch(
    request: PatchSettingsRequest,
    checkShortcuts: (next: ShortcutBindingsWire, previous: ShortcutBindingsWire) => Promise<void>,
  ): Promise<SettingsResponse> {
    return this.serialize(async () => {
      if (request.onlyIfUninitialized && this.state.initialized) return this.current();
      const { onlyIfUninitialized: _seed, ...fields } = request;
      void _seed;
      if (fields.shortcuts)
        fields.shortcuts = parseShortcutBindings(fields.shortcuts, process.platform);
      if (fields.shortcuts !== undefined)
        await checkShortcuts(
          fields.shortcuts ?? DEFAULT_SHORTCUTS,
          this.state.settings.shortcuts ?? DEFAULT_SHORTCUTS,
        );
      return this.write({ ...this.state.settings, ...fields }, true);
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
