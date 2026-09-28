import path from 'node:path';
import {
  createRunSnapshot,
  resolveCatalog,
  type InstalledPlugin,
  type PluginRunSnapshot,
  type PluginStateFile,
  type ResolvedCatalog,
  type SecretStore,
  type SubstitutionContext,
} from '@ai/plugin-kit';
import { createPluginInstaller, type PluginInstaller } from '@ai/plugin-kit/node';
import { createLogger, type Logger } from '../logging.js';
import { readServiceId, servicePaths } from '../storage.js';
import { loadHostPlugins, type HostCatalog } from './host-plugins.js';
import { migrateLegacySkills } from './migrate.js';
import { keyringSecretStore } from './secrets.js';

/**
 * A path under `<dataDir>/plugin-host`, the host's own plugin files (rendered skills, run
 * snapshots, the migration marker). The installer owns `<dataDir>/plugins` alone.
 */
export function pluginHostPath(dataDir: string, ...parts: string[]): string {
  return path.join(dataDir, 'plugin-host', ...parts);
}

/** Everything one resolution pass saw: the catalog and the inputs it was computed from. */
export interface PluginView {
  catalog: ResolvedCatalog;
  installed: InstalledPlugin[];
  /** The persisted installer state, without the memory-pause overlay. */
  state: PluginStateFile;
  host: HostCatalog;
}

/**
 * The service's plugin authority for one dataDir (D1): one plugin-kit installer rooted at
 * `<dataDir>/plugins`, the keyring secret store, and the host plugins synthesized from the
 * service's own stores. Resolution is recomputed per call from those stores, so a store edited
 * elsewhere (a command save, an MCP configure) is reflected without a cache to invalidate.
 */
export class PluginHost {
  private static readonly hosts = new Map<string, Promise<PluginHost>>();

  private constructor(
    readonly dataDir: string,
    readonly agentDir: string,
    readonly installer: PluginInstaller,
    private readonly secrets: SecretStore,
    readonly log: Logger,
  ) {}

  /**
   * The host for `dataDir`, created once. Creation migrates the legacy installed skills
   * (plugins/migrate.ts) before anyone reads the catalog; the first caller's logger is kept.
   */
  static for(dataDir: string, log?: Logger): Promise<PluginHost> {
    const existing = PluginHost.hosts.get(dataDir);
    if (existing) return existing;
    const pending = PluginHost.create(dataDir, log ?? createLogger('warn'));
    void pending.catch(() => PluginHost.hosts.delete(dataDir));
    PluginHost.hosts.set(dataDir, pending);
    return pending;
  }

  private static async create(dataDir: string, log: Logger): Promise<PluginHost> {
    const paths = servicePaths(dataDir);
    const secrets = keyringSecretStore(await readServiceId(paths), log);
    const installer = createPluginInstaller({
      root: path.join(dataDir, 'plugins'),
      secrets,
      logger: { info: log.info, warn: log.warn },
    });
    const host = new PluginHost(dataDir, paths.agentDir, installer, secrets, log);
    await migrateLegacySkills(host).catch((error: unknown) => {
      log.warn('Legacy skill migration failed; it runs again on the next start.', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return host;
  }

  hostDir(...parts: string[]): string {
    return pluginHostPath(this.dataDir, ...parts);
  }

  /**
   * Resolves host and installed plugins now. Host item switches come from their own stores
   * (loadHostPlugins), so installer state only ever holds installed and shared plugins' switches.
   */
  async view(): Promise<PluginView> {
    const [installed, state, host] = await Promise.all([
      this.installer.list(),
      this.installer.readState(),
      loadHostPlugins(this.dataDir, this.agentDir, this.log),
    ]);
    const catalog = resolveCatalog({
      host: host.plugins,
      installed,
      state,
      secretsSet: await this.secretsSet(installed),
    });
    return { catalog, installed, state, host };
  }

  /** The run snapshot of a view: effective items, and the revisions of the plugins they use. */
  static runSnapshot(view: PluginView): PluginRunSnapshot {
    const revisions = Object.fromEntries(
      view.installed.map((plugin) => [plugin.id, plugin.revision]),
    );
    return createRunSnapshot(view.catalog, revisions);
  }

  /** Substitution values for one installed plugin revision (plugin-kit `substitute*`). */
  async substitution(
    plugin: InstalledPlugin,
    revision = plugin.revision,
  ): Promise<SubstitutionContext> {
    const options = plugin.plugin.userConfig;
    return {
      root: this.installer.revisionDir(plugin.id, revision),
      data: await this.installer.dataDir(plugin.id),
      config: await this.installer.readConfig(plugin.id, options),
      sensitive: new Set(options.filter((option) => option.sensitive).map((option) => option.key)),
      env: process.env,
    };
  }

  /** Sensitive config keys with a stored secret, per installed plugin. */
  async secretsSet(installed: readonly InstalledPlugin[]): Promise<Record<string, string[]>> {
    const entries = await Promise.all(
      installed.map(async (plugin) => {
        const sensitive = plugin.plugin.userConfig.filter((option) => option.sensitive);
        const set = await Promise.all(
          sensitive.map(async (option) =>
            (await this.secrets.get(plugin.id, option.key)) === null ? [] : [option.key],
          ),
        );
        return [plugin.id, set.flat()] as const;
      }),
    );
    return Object.fromEntries(entries);
  }
}
