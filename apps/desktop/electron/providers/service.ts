import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { Type } from 'typebox';
import type { SettingsStore } from '../settings-store';
import { parse } from '../agent/validation';
import { providerFuture } from '../agent/service-manage';
import type { ServiceConnection } from '../service/connection';
import { connectLive, disconnectLive, fetchCatalog, fetchLiveProviders } from './live';
import {
  ConnectionDraftSchema,
  ModelReferenceSchema,
  PROVIDER_IPC,
  type Connection,
  type ConnectionDraft,
  type ModelReference,
  type ProviderCatalogEntry,
} from './schema';

const identity = Type.String({ minLength: 1, maxLength: 256, pattern: '^[a-zA-Z0-9_-]+$' });
const revisionSchema = Type.Integer({ minimum: 1 });

/**
 * Live provider client for list/connect/disconnect. Create/update/default/
 * model/levels/refresh/verify/login stay honest futures (not faked).
 */
export class ProviderService {
  private connection: ServiceConnection | null = null;
  private live: { defaultConnectionId: string | null; connections: Connection[] } | null = null;

  constructor(
    private store: SettingsStore,
    private changed: () => void,
    _publish: (channel: string, value: unknown) => void,
  ) {
    void this.store;
    void _publish;
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

  async save(value: ConnectionDraft): Promise<Connection> {
    const options = this.connection?.options();
    if (!options) throw new Error('The service is not connected. Connect in Settings → Service.');
    const saved = await connectLive(options, value);
    await this.sync();
    return saved;
  }

  async setDefault(_id: string, _revision: number): Promise<never> {
    providerFuture();
  }

  async setModel(_reference: ModelReference, _revision: number): Promise<never> {
    providerFuture();
  }

  async disconnect(id: string, revision: number): Promise<void> {
    const options = this.connection?.options();
    if (!options) throw new Error('The service is not connected. Connect in Settings → Service.');
    await disconnectLive(options, id, revision);
    await this.sync();
  }

  startCatalogSync(): void {
    return;
  }

  syncInBackground(_id: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  async refresh(_id: string, _network = true): Promise<void> {
    await this.sync();
  }

  async verify(_reference: ModelReference): Promise<never> {
    providerFuture();
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
    handle(PROVIDER_IPC.levels, () => [], false);
    handle(PROVIDER_IPC.disconnect, (id, revision) =>
      this.disconnect(parse(identity, id), parse(revisionSchema, revision)),
    );
    handle(PROVIDER_IPC.refresh, (id) => this.refresh(parse(identity, id)));
    handle(PROVIDER_IPC.verify, (reference) => this.verify(parse(ModelReferenceSchema, reference)));
    ipcMain.handle(PROVIDER_IPC.login, (event) => {
      assertSender(event, true);
      providerFuture();
    });
    handle(PROVIDER_IPC.cancel, () => providerFuture());
    handle(PROVIDER_IPC.openLink, () => providerFuture());
    handle(PROVIDER_IPC.answer, () => providerFuture());
  }
}
