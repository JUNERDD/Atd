import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { Type } from 'typebox';
import {
  getProviderLevels,
  refreshProvider,
  setDefaultProvider,
  setProviderModel,
  verifyProvider,
  type AgentClientOptions,
} from '@ai/agent-client';
import type { SettingsStore } from '../settings-store';
import { parse } from '../agent/validation';
import type { ServiceConnection } from '../service/connection';
import { CatalogSync } from './catalog-sync';
import { disconnectLive, fetchCatalog, fetchLiveProviders, saveLive } from './live';
import { ProviderLoginClient } from './login-client';
import { PROVIDER_IPC } from './ipc-channels';
import {
  ConnectionDraftSchema,
  ModelReferenceSchema,
  type Connection,
  type ConnectionDraft,
  type ModelReference,
  type ModelThinkingLevel,
  type ProviderCatalogEntry,
} from './schema';

const identity = Type.String({ minLength: 1, maxLength: 256, pattern: '^[a-zA-Z0-9_-]+$' });
const revisionSchema = Type.Integer({ minimum: 1 });

/**
 * Live provider client over the service: every write goes to the service,
 * then the settings snapshot reloads from it.
 */
export class ProviderService {
  private connection: ServiceConnection | null = null;
  private live: { defaultConnectionId: string | null; connections: Connection[] } | null = null;
  private readonly login: ProviderLoginClient;
  private readonly catalogSync = new CatalogSync(
    () => this.live?.connections ?? [],
    (id) =>
      this.write((options) => refreshProvider(options, id, true)).then(
        () => true,
        () => false,
      ),
  );

  constructor(
    private store: SettingsStore,
    private changed: () => void,
    publish: (channel: string, value: unknown) => void,
  ) {
    void this.store;
    this.login = new ProviderLoginClient(
      () => this.connection?.options() ?? null,
      (state) => publish(PROVIDER_IPC.loginEvent, state),
      // Signed-in providers can expose models that need the new credential; the refresh reloads
      // the connections either way.
      (connectionId) => void this.catalogSync.sync(connectionId),
    );
  }

  attach(connection: ServiceConnection) {
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

  /** Service catalog when connected, else the local fallback. Never resolves []. */
  async catalog(): Promise<ProviderCatalogEntry[]> {
    return fetchCatalog(this.connection?.options() ?? null);
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

  async setModel(reference: ModelReference, revision: number): Promise<void> {
    await this.write((options) =>
      setProviderModel(options, reference.connectionId, reference.modelId, revision),
    );
  }

  async disconnect(id: string, revision: number): Promise<void> {
    await this.write((options) => disconnectLive(options, id, revision));
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
   * The thinking levels Pi accepts for one saved connection's model, lowest first. Until the
   * live list loads, the settings snapshot carries the local store's connections, whose ids the
   * service does not know; a reference outside the live list answers no levels, and the renderer
   * asks again once the live snapshot replaces that reference.
   */
  async levels(reference: ModelReference): Promise<ModelThinkingLevel[]> {
    if (!this.live) await this.sync();
    const known = this.live?.connections.some(
      (connection) => connection.connectionId === reference.connectionId,
    );
    if (!known) return [];
    const { levels } = await getProviderLevels(
      this.options(),
      reference.connectionId,
      reference.modelId,
    );
    return levels;
  }

  installIpc(assertSender: (event: IpcMainInvokeEvent, settingsOnly?: boolean) => void) {
    const handle = (
      channel: string,
      action: (...args: unknown[]) => unknown,
      settingsOnly = true,
    ) =>
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        assertSender(event, settingsOnly);
        return action(...args);
      });
    handle(PROVIDER_IPC.catalog, async () => this.catalog(), false);
    handle(PROVIDER_IPC.save, (value) => this.save(parse(ConnectionDraftSchema, value)));
    handle(PROVIDER_IPC.default, (id, revision) =>
      this.setDefault(parse(identity, id), parse(revisionSchema, revision)),
    );
    handle(PROVIDER_IPC.model, (reference, revision) =>
      this.setModel(parse(ModelReferenceSchema, reference), parse(revisionSchema, revision)),
    );
    // The panel composer shows the level next to its model picker; both windows may ask.
    handle(
      PROVIDER_IPC.levels,
      (reference) => this.levels(parse(ModelReferenceSchema, reference)),
      false,
    );
    handle(PROVIDER_IPC.disconnect, (id, revision) =>
      this.disconnect(parse(identity, id), parse(revisionSchema, revision)),
    );
    handle(PROVIDER_IPC.refresh, (id) => this.refresh(parse(identity, id)));
    // Both windows show model lists: the settings pickers and the panel composer.
    handle(PROVIDER_IPC.refreshCatalogs, () => this.refreshShownCatalogs(), false);
    handle(PROVIDER_IPC.verify, (reference) => this.verify(parse(ModelReferenceSchema, reference)));
    ipcMain.handle(PROVIDER_IPC.login, async (event, value: unknown) => {
      assertSender(event, true);
      const state = await this.login.start(parse(identity, value));
      // A closed settings window cannot answer prompts; end its sign-in.
      event.sender.once('destroyed', () => void this.login.cancel(state.id).catch(() => undefined));
      return state;
    });
    handle(PROVIDER_IPC.cancel, (id) => this.login.cancel(parse(identity, id)));
    handle(PROVIDER_IPC.openLink, (id) => this.login.openLink(parse(identity, id)));
    handle(PROVIDER_IPC.answer, (id, promptId, value) =>
      this.login.answer(
        parse(identity, id),
        parse(identity, promptId),
        parse(Type.String({ maxLength: 16384 }), value),
      ),
    );
  }
}
