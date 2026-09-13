import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import type { SettingsStore } from '../settings-store';
import { parse } from '../agent/validation';
import {
  ConnectionDraftSchema,
  ModelReferenceSchema,
  PROVIDER_IPC,
  type ConnectionDraft,
  type ModelReference,
} from './schema';
import {
  configurationId,
  isCustom,
  modelDefinition,
  publicConnection,
  validateConfig,
} from './configuration';
import { decryptCredential, encryptCredential } from './credentials';
import { ProviderRuntime } from './runtime';
import { ProviderLogin } from './login';
import { refreshLocalModels } from './local-models';
import { refreshLlamaModels } from './llama-models';
import { initialDefaultConnectionId } from './defaults';

const identity = Type.String({ minLength: 1, maxLength: 256, pattern: '^[a-zA-Z0-9_-]+$' });
const revisionSchema = Type.Integer({ minimum: 1 });
export class ProviderService {
  readonly runtime: ProviderRuntime;
  readonly login: ProviderLogin;
  constructor(
    private store: SettingsStore,
    private changed: () => void,
    publish: (channel: string, value: unknown) => void,
  ) {
    this.runtime = new ProviderRuntime(store);
    this.login = new ProviderLogin(
      this.runtime,
      (state) => publish(PROVIDER_IPC.loginEvent, state),
      changed,
    );
  }
  async save(value: ConnectionDraft) {
    const { connectionId, expectedRevision, apiKey, ...config } = parse(
      ConnectionDraftSchema,
      value,
    );
    validateConfig(config);
    const catalog = (await this.runtime.catalog()).find((item) => item.id === config.provider);
    if (!catalog) throw new Error('This provider is not registered in Pi.');
    if (
      !catalog.auth.some((auth) => auth.type === config.authType) &&
      !(config.authType === 'api_key' && catalog.category === 'cloud')
    )
      throw new Error('This authentication method is not supported by this provider.');
    if (
      apiKey &&
      [...apiKey].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error('Enter a valid API key.');
    const id = connectionId ?? randomUUID();
    await this.store.change((data) => {
      const previous = data.connections.find((item) => item.connectionId === id);
      if (connectionId && (!previous || previous.revision !== expectedRevision))
        throw new Error('This connection changed. Reload its saved settings before saving.');
      if (
        previous &&
        (config.provider !== previous.provider || config.authType !== previous.authType)
      )
        throw new Error(
          'Add a separate connection to change the provider or authentication method.',
        );
      const configurationChanged =
        previous && configurationId(previous) !== configurationId(config);
      if (
        previous?.encryptedCredential &&
        previous.baseUrl !== config.baseUrl &&
        apiKey === undefined
      )
        throw new Error(
          'Enter the API key again, or explicitly remove it, when changing the endpoint.',
        );
      const credential =
        apiKey === undefined
          ? decryptCredential(previous?.encryptedCredential ?? '')
          : apiKey.trim()
            ? { type: 'api_key' as const, key: apiKey.trim(), env: config.options }
            : undefined;
      const encryptedCredential = credential ? encryptCredential(credential) : '';
      const connection = {
        ...config,
        connectionId: id,
        revision: (previous?.revision ?? 0) + 1,
        encryptedCredential,
        connected:
          Boolean(credential) || config.authType === 'none' || config.authType === 'ambient',
        catalog: configurationChanged ? [] : (previous?.catalog ?? []),
        catalogError: configurationChanged ? '' : (previous?.catalogError ?? ''),
        verifiedModel:
          configurationChanged || apiKey !== undefined ? '' : (previous?.verifiedModel ?? ''),
      };
      if (previous) data.connections[data.connections.indexOf(previous)] = connection;
      else data.connections.push(connection);
      data.defaultConnectionId ??= initialDefaultConnectionId(data.connections, id);
    });
    this.runtime.invalidate(id);
    // Static catalogs are available without a billable verification or authentication request.
    await this.refresh(id, false);
    this.changed();
    return publicConnection(this.runtime.connection(id));
  }
  async setDefault(id: string, revision: number) {
    const connection = this.runtime.connection(id);
    if (!connection.defaultModel) throw new Error('Choose a default model first.');
    await this.runtime.resolve({ connectionId: id, modelId: connection.defaultModel });
    await this.store.change((data) => {
      if (data.connections.find((item) => item.connectionId === id)?.revision !== revision)
        throw new Error('The connection changed. Try again.');
      data.defaultConnectionId = id;
    });
    this.changed();
  }
  async setModel(reference: ModelReference, revision: number) {
    const connection = this.runtime.connection(reference.connectionId);
    const model = (await this.runtime.models(connection)).getModel(
      connection.provider,
      reference.modelId,
    );
    if (!model) throw new Error('This model is unavailable in the connection catalog.');
    await this.store.change((data) => {
      const current = data.connections.find((item) => item.connectionId === reference.connectionId);
      if (!current || current.revision !== revision)
        throw new Error('The connection changed. Try again.');
      current.defaultModel = reference.modelId;
      current.revision++;
      data.defaultConnectionId ??= initialDefaultConnectionId(
        data.connections,
        current.connectionId,
      );
    });
    this.changed();
  }
  async disconnect(id: string, revision: number) {
    this.login.cancelConnection(id);
    await this.store.change((data) => {
      const current = data.connections.find((item) => item.connectionId === id);
      if (!current || current.revision !== revision)
        throw new Error('The connection changed. Try again.');
      current.encryptedCredential = '';
      current.connected = false;
      current.verifiedModel = '';
      current.revision++;
    });
    this.runtime.invalidate(id);
    this.changed();
  }
  async refresh(id: string, network = true) {
    const connection = this.runtime.connection(id);
    const configuration = configurationId(connection);
    try {
      const models = await this.runtime.models(connection);
      let catalog;
      if (network && isCustom(connection.provider)) {
        if (!connection.connected) throw new Error('Reconnect before refreshing.');
        const auth = await models.getAuth(connection.provider);
        if (!auth) throw new Error('Complete authentication before refreshing.');
        catalog = await (connection.provider === 'llamacpp'
          ? refreshLlamaModels(connection, auth)
          : refreshLocalModels(connection, auth));
      } else {
        const result = await models.refresh({
          providers: [connection.provider],
          allowNetwork: network,
          force: network,
          signal: AbortSignal.timeout(15000),
        });
        if (result.aborted || result.errors.size)
          throw new Error('The model catalog could not be refreshed.');
        catalog = models.getModels(connection.provider).map(modelDefinition);
      }
      await this.store.change((data) => {
        const current = data.connections.find((item) => item.connectionId === id);
        if (current && configurationId(current) === configuration) {
          current.catalog = catalog;
          current.catalogError = '';
        }
      });
      if (isCustom(connection.provider)) this.runtime.invalidate(id);
    } catch {
      await this.store.change((data) => {
        const current = data.connections.find((item) => item.connectionId === id);
        if (current && configurationId(current) === configuration)
          current.catalogError =
            'Could not refresh models. Your saved catalog and model preference are preserved.';
      });
      if (network) {
        this.changed();
        throw new Error(
          'Could not refresh models. Your saved catalog and model preference are preserved.',
        );
      }
    }
    this.changed();
  }
  async verify(reference: ModelReference) {
    const selected = await this.runtime.resolve(reference);
    const connection = this.runtime.assertModel(selected);
    const models = await this.runtime.models(connection);
    const model = models.getModel(connection.provider, reference.modelId);
    if (!model) throw new Error('This model is unavailable.');
    const result = await models.completeSimple(
      model,
      { messages: [{ role: 'user', content: 'Reply OK.', timestamp: Date.now() }] },
      { maxTokens: 16, signal: AbortSignal.timeout(30000) },
    );
    if (result.stopReason === 'error' || result.stopReason === 'aborted')
      throw new Error(
        'Model verification failed. Check the connection, model access and available quota.',
      );
    this.runtime.assertModel(selected);
    await this.store.change((data) => {
      const current = data.connections.find((item) => item.connectionId === reference.connectionId);
      if (current) current.verifiedModel = reference.modelId;
    });
    this.changed();
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
    handle(PROVIDER_IPC.catalog, () => this.runtime.catalog(), false);
    handle(PROVIDER_IPC.save, (value) => this.save(parse(ConnectionDraftSchema, value)));
    handle(PROVIDER_IPC.default, (id, revision) =>
      this.setDefault(parse(identity, id), parse(revisionSchema, revision)),
    );
    handle(PROVIDER_IPC.model, (reference, revision) =>
      this.setModel(parse(ModelReferenceSchema, reference), parse(revisionSchema, revision)),
    );
    handle(PROVIDER_IPC.disconnect, (id, revision) =>
      this.disconnect(parse(identity, id), parse(revisionSchema, revision)),
    );
    handle(PROVIDER_IPC.refresh, (id) => this.refresh(parse(identity, id)));
    handle(PROVIDER_IPC.verify, (reference) => this.verify(parse(ModelReferenceSchema, reference)));
    ipcMain.handle(PROVIDER_IPC.login, async (event, value: unknown) => {
      assertSender(event, true);
      const id = parse(identity, value);
      const close = () => this.login.cancelConnection(id);
      event.sender.once('destroyed', close);
      try {
        const state = await this.login.start(id);
        if (event.sender.isDestroyed()) this.login.cancel(state.id);
        return state;
      } catch (error) {
        event.sender.removeListener('destroyed', close);
        throw error;
      }
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
