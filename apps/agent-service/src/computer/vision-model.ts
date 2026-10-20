import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ModelSelection, ServiceModel } from '@atd/agent-contracts';
import { ConnectionStore } from '../credentials/connections.js';
import { KeyringBackend } from '../credentials/keyring.js';
import { presentConnection } from '../providers/connection-view.js';
import { connectionCredentials, connectionRuntime } from '../providers/runtime.js';
import { readStoredSettings } from '../settings/store.js';
import { readServiceId, type ServicePaths } from '../storage.js';

/** Safe feature diagnostics; arbitrary provider errors stay out of the model's observation text. */
export class ScreenVisionUnavailable extends Error {
  constructor(
    readonly reason:
      | 'unsupportedModel'
      | 'connectionUnavailable'
      | 'configurationChanged'
      | 'modelUnavailable'
      | 'authRequired'
      | 'requestFailed',
    message: string,
  ) {
    super(message);
  }
}

export async function screenVisionSelection(dataDir: string): Promise<ModelSelection | null> {
  return (await readStoredSettings(dataDir))?.settings.computerVisionModel ?? null;
}

function sameSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left?.connectionId === right?.connectionId && left?.modelId === right?.modelId;
}

/** Sharing's image gate is independent of the acting model's screenshot qualification. */
export async function screenVisionAvailable(
  dataDir: string,
  primary: ServiceModel,
  primaryAcceptsImages: boolean,
): Promise<boolean> {
  const selection = await screenVisionSelection(dataDir);
  if (!selection) return primaryAcceptsImages;
  const store = await ConnectionStore.load(dataDir);
  const connection = store.data.connections.find(
    (item) => item.connectionId === selection.connectionId,
  );
  if (!connection?.connected) return false;
  if (
    sameSelection(selection, primary) &&
    primary.configurationId &&
    primary.configurationId !== connection.configurationId
  )
    return false;
  const { catalog } = await presentConnection(connection);
  return catalog?.find((model) => model.id === selection.modelId)?.input.includes('image') ?? false;
}

interface VisionRouteBase {
  model: Model<Api>;
  /** Rechecks the selected setting and connection configuration after asynchronous work. */
  stillCurrent: () => Promise<boolean>;
}

export type VisionRoute =
  | (VisionRouteBase & { kind: 'direct' })
  | (VisionRouteBase & {
      kind: 'auxiliary';
      models: Pick<ModelRuntime, 'completeSimple'>;
      selection: ModelSelection;
    });

/** One reusable, connection-bound runtime per task session; no task model is changed. */
export class ScreenVisionResolver {
  private cached: { key: string; models: ModelRuntime } | undefined;

  constructor(private readonly paths: ServicePaths) {}

  async resolve(
    primary: ServiceModel,
    model: Model<Api> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<VisionRoute> {
    const selection = await screenVisionSelection(this.paths.root);
    signal?.throwIfAborted();
    if (!selection) {
      if (!model?.input.includes('image'))
        throw new ScreenVisionUnavailable(
          'unsupportedModel',
          'The current task model does not accept images. Select a visual model in Settings → Computer.',
        );
      return {
        kind: 'direct',
        model,
        stillCurrent: async () => (await screenVisionSelection(this.paths.root)) === null,
      };
    }
    const connections = await ConnectionStore.load(this.paths.root);
    const connection = connections.data.connections.find(
      (item) => item.connectionId === selection.connectionId,
    );
    if (!connection?.connected)
      throw new ScreenVisionUnavailable(
        'connectionUnavailable',
        'The selected visual model connection is removed or disconnected.',
      );
    const { configurationId } = connection;
    const stillCurrent = async () => {
      await connections.reload();
      const current = connections.data.connections.find(
        (item) => item.connectionId === selection.connectionId,
      );
      return Boolean(
        current?.connected &&
        current.configurationId === configurationId &&
        sameSelection(selection, await screenVisionSelection(this.paths.root)),
      );
    };
    if (sameSelection(selection, primary) && model) {
      if (primary.configurationId && primary.configurationId !== configurationId)
        throw new ScreenVisionUnavailable(
          'configurationChanged',
          'The selected visual model connection changed during this task run.',
        );
      if (!model.input.includes('image'))
        throw new ScreenVisionUnavailable(
          'unsupportedModel',
          'The selected visual model does not accept images.',
        );
      return { kind: 'direct', model, stillCurrent };
    }
    const { catalog } = await presentConnection(connection);
    const definition = catalog?.find((item) => item.id === selection.modelId);
    if (!definition?.input.includes('image'))
      throw new ScreenVisionUnavailable(
        'modelUnavailable',
        'The selected visual model is unavailable or does not accept images.',
      );
    const key = JSON.stringify([selection, configurationId, connection.revision, definition]);
    if (this.cached?.key !== key) {
      const stores = {
        dataDir: this.paths.root,
        connections,
        keyring: new KeyringBackend(await readServiceId(this.paths)),
      };
      const credentials = connectionCredentials(stores, connection);
      const models = await connectionRuntime(stores, connection, credentials);
      signal?.throwIfAborted();
      this.cached = { key, models };
    }
    const models = this.cached.models;
    const selected = models.getModel(connection.provider, selection.modelId);
    if (!selected?.input.includes('image'))
      throw new ScreenVisionUnavailable(
        'modelUnavailable',
        'The selected visual model is unavailable or does not accept images.',
      );
    if (!(await models.checkAuth(connection.provider, signal ? { signal } : {})))
      throw new ScreenVisionUnavailable(
        'authRequired',
        'The selected visual model has no usable credentials.',
      );
    signal?.throwIfAborted();
    return { kind: 'auxiliary', model: selected, models, selection, stillCurrent };
  }
}
