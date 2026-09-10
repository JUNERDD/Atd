import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SHORTCUTS, type ShortcutBindings } from './settings-contract';
import { defaultProvider, parseStoredProvider, type StoredProvider } from './settings-provider';
import { parseShortcutBindings } from './settings-shortcuts';

export interface StoredSettings {
  version: 1;
  provider: StoredProvider;
  shortcuts: ShortcutBindings;
  pinned: boolean;
}

function parseSettings(value: unknown): StoredSettings {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !['version', 'provider', 'shortcuts', 'pinned'].includes(key),
    ) ||
    !('version' in value) ||
    value.version !== 1 ||
    !('provider' in value) ||
    !('shortcuts' in value) ||
    !('pinned' in value) ||
    typeof value.pinned !== 'boolean'
  ) {
    throw new TypeError('Invalid saved settings.');
  }
  return {
    version: 1,
    provider: parseStoredProvider(value.provider),
    shortcuts: parseShortcutBindings(value.shortcuts),
    pinned: value.pinned,
  };
}

export class SettingsStore {
  private value: StoredSettings;

  private constructor(
    private readonly file: string,
    settings: StoredSettings,
  ) {
    this.value = settings;
  }

  static async load(): Promise<SettingsStore> {
    const file = path.join(app.getPath('userData'), 'settings.json');
    try {
      if ((await stat(file)).size > 65_536) throw new Error('Settings file is too large');
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      return new SettingsStore(file, parseSettings(parsed));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return new SettingsStore(file, {
          version: 1,
          provider: defaultProvider(),
          shortcuts: { ...DEFAULT_SHORTCUTS },
          pinned: true,
        });
      }
      throw new Error(
        'Saved settings could not be read. The existing settings file was preserved.',
      );
    }
  }

  get current(): StoredSettings {
    return this.value;
  }

  async commit(settings: StoredSettings): Promise<void> {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(this.file), { recursive: true });
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(settings));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.file);
      this.value = settings;
    } catch {
      throw new Error('Settings could not be saved on this device.');
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
