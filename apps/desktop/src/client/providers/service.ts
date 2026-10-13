import {
  getProviderContexts,
  getProviderLevels,
  refreshProvider,
  setDefaultProvider,
  setProviderContext,
  setProviderModel,
  verifyProvider,
  type AgentClientOptions,
} from '@atd/agent-client';
import { CatalogSync } from './catalog-sync';
import { disconnectLive, fetchCatalog, fetchLiveProviders, removeLive, saveLive } from './live';
import { ProviderLoginClient } from './login-client';
import type {
  Connection,
  ConnectionDraft,
  LoginState,
  ModelContexts,
  ModelContextChoice,
  ModelLevels,
  ModelReference,
  ModelThinkingLevel,
  ProviderCatalogEntry,
} from './schema';

/** The connection the provider client reads its service options from, once it exists. */
export interface ProviderConnection {
  options(): AgentClientOptions | null;
}

/**
 * Live provider client over the service, shared by the desktop main process and the web client:
 * every write goes to the service, then the settings snapshot reloads from it. Writes made by
 * another client arrive as a `providers` invalidation, which calls `sync`.
 */
export class ProviderService {
  private connection: ProviderConnection | null = null;
  private live: { defaultConnectionId: string | null; connections: Connection[] } | null = null;
  readonly login: ProviderLoginClient;
  private readonly catalogSync = new CatalogSync(
    () => this.live?.connections ?? [],
    (id) =>
      this.write((options) => refreshProvider(options, id, true)).then(
        () => true,
        () => false,
      ),
  );

  /** `openExternal` shows a sign-in link: the system browser in the desktop, a new tab on the web. */
  constructor(
    private changed: () => void,
    publishLogin: (state: LoginState) => void,
    openExternal: (url: string) => Promise<void>,
  ) {
    this.login = new ProviderLoginClient(
      () => this.connection?.options() ?? null,
      publishLogin,
      // Signed-in providers can expose models that need the new credential; the refresh reloads
      // the connections either way.
      (connectionId) => void this.catalogSync.sync(connectionId),
      openExternal,
    );
  }

  attach(connection: ProviderConnection) {
    this.connection = connection;
  }

  overlay(): { defaultConnectionId: string | null; connections: Connection[] } | null {
    return this.live;
  }

  async sync(): Promise<void> {
    const options = this.connection?.options();
    if (!options) {
      this.live = null;
      this.changed();
      return;
    }
    this.live = await fetchLiveProviders(options);
    this.changed();
  }

  /** The complete service catalog; failures remain retryable in settings. */
  async catalog(): Promise<ProviderCatalogEntry[]> {
    return fetchCatalog(this.options());
  }

  private options(): AgentClientOptions {
    const options = this.connection?.options();
    if (!options) throw new Error('The service is not connected. Connect in Settings → Service.');
    return options;
  }

  /**
   * Runs one service write, then reloads connections. A failed write reloads
   * too — a conflict shows the newer revision, a failed refresh its error —
   * but reports its own error rather than one from the reload.
   */
  private async write<T>(operation: (options: AgentClientOptions) => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await operation(this.options());
    } catch (error) {
      await this.sync().catch(() => undefined);
      throw error;
    }
    await this.sync();
    return result;
  }

  async save(value: ConnectionDraft): Promise<Connection> {
    const saved = await this.write((options) => saveLive(options, value));
    // Model discovery continues in the background so saving stays responsive.
    void this.catalogSync.sync(saved.connectionId);
    return saved;
  }

  async setDefault(id: string, revision: number): Promise<void> {
    await this.write((options) => setDefaultProvider(options, id, revision));
  }

  async setModel(
    reference: ModelReference,
    revision: number,
    thinkingLevel?: ModelThinkingLevel,
  ): Promise<void> {
    await this.write((options) =>
      setProviderModel(options, reference.connectionId, reference.modelId, revision, thinkingLevel),
    );
  }

  async setContext(
    reference: ModelReference,
    choice: ModelContextChoice,
    revision: number,
  ): Promise<void> {
    await this.write((options) =>
      setProviderContext(options, reference.connectionId, reference.modelId, choice, revision),
    );
  }

  async disconnect(id: string, revision: number): Promise<void> {
    await this.write((options) => disconnectLive(options, id, revision));
  }

  async remove(id: string, revision: number): Promise<string | undefined> {
    return this.write((options) => removeLive(options, id, revision));
  }

  /**
   * Refreshes stale connected catalogs in the background now and every interval after. Call it
   * whenever the service connects, once the connections have loaded.
   */
  syncCatalogs(): void {
    this.catalogSync.start();
  }

  /** A model list opened in either window; see `ProviderBridge.refreshCatalogs`. */
  refreshShownCatalogs(): void {
    this.catalogSync.shown();
  }

  /** `network: false` only reloads the saved catalog; a refresh failure is kept on the row. */
  async refresh(id: string, network = true): Promise<void> {
    if (!network) return this.sync();
    await this.write((options) => refreshProvider(options, id, false));
  }

  async verify(reference: ModelReference): Promise<void> {
    await this.write((options) =>
      verifyProvider(options, reference.connectionId, reference.modelId),
    );
  }

  /**
   * The thinking levels Pi accepts for one saved connection's model, lowest first, and the level
   * it runs at when none is chosen. A connection outside the service's live list answers no
   * levels and defaults to off.
   */
  async levels(reference: ModelReference): Promise<ModelLevels> {
    if (!(await this.isLive(reference.connectionId))) return { levels: [], defaultLevel: 'off' };
    return getProviderLevels(this.options(), reference.connectionId, reference.modelId);
  }

  /**
   * One saved connection's model's context windows. Like `levels`, a connection outside the live
   * list answers no tiers and no windows.
   */
  async contexts(reference: ModelReference): Promise<ModelContexts> {
    const none: ModelContexts = {
      options: [],
      defaultTier: null,
      selected: null,
      catalogWindow: null,
      choices: [],
      custom: null,
    };
    if (!(await this.isLive(reference.connectionId))) return none;
    return getProviderContexts(this.options(), reference.connectionId, reference.modelId);
  }

  private async isLive(connectionId: string): Promise<boolean> {
    if (!this.live) await this.sync();
    return Boolean(
      this.live?.connections.some((connection) => connection.connectionId === connectionId),
    );
  }
}
