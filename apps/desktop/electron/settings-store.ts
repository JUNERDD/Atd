import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SHORTCUTS, parseShortcutBindings } from '@ai/agent-contracts';
import {
  isAppLanguage,
  resolveLanguage,
  type AppLanguage,
  type ShortcutBindings,
} from './settings-contract';
import { Type, type Static } from 'typebox';
import {
  DEFAULT_PERMISSION_TIER,
  PERMISSION_TIERS,
  type PermissionTier,
} from './agent/permission-schema';
import { parse } from './agent/validation';
import { StoredConnectionSchema } from './providers/schema';
import { migrateProvider } from './providers/legacy';
import { initialDefaultConnectionId } from './providers/defaults';
import { parseStoredShellAllowlist } from './settings-shell';
import { PANEL_SIZE, type PanelSize } from './window-position';

const ProviderSettingsSchema = Type.Object({
  connections: Type.Array(StoredConnectionSchema, { maxItems: 100 }),
  defaultConnectionId: Type.Union([Type.String(), Type.Null()]),
});
const PanelSizeSchema = Type.Object(
  { width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export interface StoredSettings extends Static<typeof ProviderSettingsSchema> {
  version: 2;
  language: AppLanguage;
  shortcuts: ShortcutBindings;
  pinned: boolean;
  /** macOS: whether the app keeps a Dock icon; the menu bar status item stays either way. */
  showInDock: boolean;
  panelSize: PanelSize;
  permissionTier: PermissionTier;
  /** User shell allowlist in the user's order; see `SettingsSnapshot.shellAllowlist`. */
  shellAllowlist: string[];
}

function isPermissionTier(value: unknown): value is PermissionTier {
  return typeof value === 'string' && PERMISSION_TIERS.includes(value as PermissionTier);
}

function parseSettings(value: unknown): StoredSettings {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'version',
          'provider',
          'connections',
          'defaultConnectionId',
          'language',
          'shortcuts',
          'pinned',
          'showInDock',
          'panelSize',
          'permissionTier',
          'shellAllowlist',
        ].includes(key),
    ) ||
    !('version' in value) ||
    (value.version !== 1 && value.version !== 2) ||
    !('shortcuts' in value) ||
    !('pinned' in value) ||
    typeof value.pinned !== 'boolean'
  ) {
    throw new TypeError('Invalid saved settings.');
  }
  const language = 'language' in value ? value.language : resolveLanguage(app.getLocale());
  if (!isAppLanguage(language)) throw new TypeError('Invalid saved settings.');
  // Existing files omit this field; default to manual rather than rejecting the file.
  let permissionTier: PermissionTier = DEFAULT_PERMISSION_TIER;
  if ('permissionTier' in value) {
    if (!isPermissionTier(value.permissionTier)) throw new TypeError('Invalid saved settings.');
    permissionTier = value.permissionTier;
  }
  // Files saved before the preference existed keep the default: no Dock icon.
  let showInDock = false;
  if ('showInDock' in value) {
    if (typeof value.showInDock !== 'boolean') throw new TypeError('Invalid saved settings.');
    showInDock = value.showInDock;
  }
  const panelSize =
    'panelSize' in value ? parse(PanelSizeSchema, value.panelSize) : { ...PANEL_SIZE };
  const connections =
    value.version === 1 && 'provider' in value ? migrateProvider(value.provider) : null;
  const providers = connections
    ? { connections, defaultConnectionId: connections[0]?.connectionId ?? null }
    : parse(ProviderSettingsSchema, {
        connections: 'connections' in value ? value.connections : null,
        defaultConnectionId: 'defaultConnectionId' in value ? value.defaultConnectionId : null,
      });
  if (
    new Set(providers.connections.map((connection) => connection.connectionId)).size !==
    providers.connections.length
  )
    throw new Error('Duplicate saved connection identities.');
  return {
    version: 2,
    ...providers,
    language,
    shortcuts: parseShortcutBindings(value.shortcuts, process.platform),
    pinned: value.pinned,
    showInDock,
    panelSize,
    permissionTier,
    shellAllowlist: parseStoredShellAllowlist(
      'shellAllowlist' in value ? value.shellAllowlist : null,
    ),
  };
}

export class SettingsStore {
  private value: StoredSettings;
  private mutation: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    settings: StoredSettings,
  ) {
    this.value = settings;
  }

  static async load(): Promise<SettingsStore> {
    const file = path.join(app.getPath('userData'), 'settings.json');
    try {
      if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error('Settings file is too large');
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      const settings = parseSettings(parsed);
      const store = new SettingsStore(file, settings);
      if (settings.defaultConnectionId === null) {
        settings.defaultConnectionId = initialDefaultConnectionId(settings.connections, null);
        if (settings.defaultConnectionId !== null) await store.commit(settings);
      }
      return store;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return new SettingsStore(file, {
          version: 2,
          connections: [],
          defaultConnectionId: null,
          language: resolveLanguage(app.getLocale()),
          shortcuts: { ...DEFAULT_SHORTCUTS },
          pinned: true,
          showInDock: false,
          panelSize: { ...PANEL_SIZE },
          permissionTier: DEFAULT_PERMISSION_TIER,
          shellAllowlist: [],
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

  change<T>(update: (draft: StoredSettings) => T | Promise<T>): Promise<T> {
    const pending = this.mutation.then(async () => {
      const draft = structuredClone(this.value);
      const result = await update(draft);
      await this.commit(parseSettings(draft));
      return result;
    });
    this.mutation = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
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
