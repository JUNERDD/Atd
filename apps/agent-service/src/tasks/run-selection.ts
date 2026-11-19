import {
  findModelAlias,
  runModelSelection,
  type ModelAlias,
  type ModelSelection,
  type RunContextChoice,
  type RunModelSources,
  type ServiceModel,
  type ThinkingLevel,
} from '@atd/agent-contracts';
import type { ConnectionStore } from '../credentials/connections.js';
import { LedgerNotFound } from '../ledger.js';
import { presentConnection } from '../providers/connection-view.js';
import { resolveRunContextWindow } from '../providers/context-tiers.js';
import { modelDefaultThinkingLevel } from '../providers/default-thinking.js';

/** Connection id of runs on the operator's environment-injected credentials. */
export const TEMP_CONNECTION_ID = 'temp';

/**
 * The selection a run of these sources asks for (`runModelSelection`), checked against the saved
 * connections. Preview and submit both choose through this before `resolveRunModel` pins it.
 */
export function selectRunModel(
  connections: ConnectionStore,
  sources: Omit<
    RunModelSources,
    'aliases' | 'defaultAliasId' | 'hasConnection' | 'isConnectionUsable'
  >,
): ModelSelection | undefined {
  return runModelSelection({
    aliases: connections.data.aliases ?? [],
    defaultAliasId: connections.data.defaultAliasId ?? null,
    ...sources,
    hasConnection: (connectionId) =>
      connections.data.connections.some((item) => item.connectionId === connectionId),
    isConnectionUsable: (connectionId) =>
      connections.data.connections.some(
        (item) => item.connectionId === connectionId && item.connected,
      ),
  });
}

/**
 * Resolves both the model selection and the saved model alias (if any) supplying defaults for
 * this run (`command.mode === 'alias'` when not overridden, or `defaultAliasId` fallback).
 * Throws explicitly if a command asks for an alias that no longer exists.
 */
export function selectRunDefaults(
  connections: ConnectionStore,
  sources: Omit<
    RunModelSources,
    'aliases' | 'defaultAliasId' | 'hasConnection' | 'isConnectionUsable'
  >,
): { selection: ModelSelection | undefined; alias: ModelAlias | undefined } {
  const { aliases, defaultAliasId } = connections.data;
  if (!sources.requested && sources.command?.mode === 'alias') {
    const alias = findModelAlias(aliases, sources.command.aliasId);
    if (!alias) throw new TypeError('The chosen model alias no longer exists.');
    return { selection: { connectionId: alias.connectionId, modelId: alias.modelId }, alias };
  }
  const selection = selectRunModel(connections, sources);
  const hasLast = Boolean(
    sources.last &&
    connections.data.connections.some((item) => item.connectionId === sources.last?.connectionId),
  );
  if (!sources.requested && sources.command?.mode !== 'fixed' && !hasLast && defaultAliasId) {
    const alias = findModelAlias(aliases, defaultAliasId);
    if (
      alias &&
      connections.data.connections.some(
        (item) => item.connectionId === alias.connectionId && item.connected,
      )
    ) {
      return { selection, alias };
    }
  }
  return { selection, alias: undefined };
}

/**
 * Pins the model a run uses: the selected connection and model (`selectRunModel`), else the
 * default connection's default model. Without a default connection the run
 * falls back to the operator's temporary credentials (`AI_AGENT_TEMP_*`).
 * Preview and submit share this, so a preview shows what a submit freezes.
 */
export function resolveRunModel(
  connections: ConnectionStore,
  selection: ModelSelection | undefined,
  warnings: string[] = [],
): ServiceModel {
  if (selection) {
    // A model on temporary credentials resolves again when it is sent back, as a command's
    // previewed model or a resent run's is (connection ids are UUIDs, so none is `temp`).
    if (selection.connectionId === TEMP_CONNECTION_ID) {
      warnings.push('The run would use temporary credentials.');
      return { ...tempModel(), modelId: selection.modelId };
    }
    const connection = connections.data.connections.find(
      (item) => item.connectionId === selection.connectionId,
    );
    if (!connection) throw new LedgerNotFound('Connection', selection.connectionId);
    return {
      connectionId: connection.connectionId,
      modelId: selection.modelId,
      provider: connection.provider,
      baseUrl: connection.baseUrl,
      configurationId: connection.configurationId,
    };
  }
  const defaultId = connections.data.defaultConnectionId;
  const connection = connections.data.connections.find((item) => item.connectionId === defaultId);
  if (!connection) {
    warnings.push('No default connection; the run would use temporary credentials.');
    return tempModel();
  }
  const modelId = connection.defaultModel || 'default-model';
  if (!connection.defaultModel)
    warnings.push(`Connection ${connection.connectionId} has no default model.`);
  return {
    connectionId: connection.connectionId,
    modelId,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    configurationId: connection.configurationId,
  };
}

/**
 * The requested level, else the level saved on the run's connection, else the model's own
 * default (`modelDefaultThinkingLevel`). Absent only for a model outside the loaded catalog,
 * which then runs with reasoning off. Pi clamps the level to the model when the run starts.
 */
export function resolveRunThinkingLevel(
  connections: ConnectionStore,
  model: ServiceModel,
  requested: ThinkingLevel | undefined,
  catalog: RunCatalog,
): ThinkingLevel | undefined {
  return (
    requested ??
    connections.data.connections.find((item) => item.connectionId === model.connectionId)
      ?.defaultThinkingLevel ??
    catalog.defaultThinkingLevel(model)
  );
}

/** What a run freezes from its connection's catalog; undefined for a model outside it. */
export interface RunCatalog {
  /** The window to freeze; undefined keeps the catalog window. */
  contextWindow(model: ServiceModel, contextChoice?: RunContextChoice): number | undefined;
  /** The model's level when neither the request nor the connection names one. */
  defaultThinkingLevel(model: ServiceModel): ThinkingLevel | undefined;
}

const NO_CATALOG: RunCatalog = {
  contextWindow: () => undefined,
  defaultThinkingLevel: () => undefined,
};

/**
 * Loads `RunCatalog` for the connection a selection (else the default) names: its presented
 * catalog and saved tiers. Submit loads it before acceptance, so the freeze itself stays
 * synchronous; a model on another connection, or the temp connection, gets nothing from it.
 */
export async function loadRunCatalog(
  connections: ConnectionStore,
  selection: ModelSelection | undefined,
): Promise<RunCatalog> {
  const connectionId = selection?.connectionId ?? connections.data.defaultConnectionId;
  const connection = connections.data.connections.find(
    (item) => item.connectionId === connectionId,
  );
  if (!connection) return NO_CATALOG;
  const { catalog = [] } = await presentConnection(connection);
  const owns = (model: ServiceModel) => model.connectionId === connection.connectionId;
  return {
    contextWindow: (model, contextChoice) => {
      if (!owns(model)) return undefined;
      const definition = catalog.find((item) => item.id === model.modelId);
      return resolveRunContextWindow(
        contextChoice,
        connection,
        model.modelId,
        definition?.contextWindow,
        catalog,
      );
    },
    defaultThinkingLevel: (model) => {
      const definition = owns(model)
        ? catalog.find((item) => item.id === model.modelId)
        : undefined;
      return definition && modelDefaultThinkingLevel(connection.provider, definition);
    },
  };
}

function tempModel(): ServiceModel {
  const provider = process.env.AI_AGENT_TEMP_PROVIDER?.trim() || 'openai-compatible';
  if (provider !== 'openai' && provider !== 'openai-compatible')
    throw new TypeError('AI_AGENT_TEMP_PROVIDER must be openai or openai-compatible.');
  return {
    connectionId: TEMP_CONNECTION_ID,
    modelId: process.env.AI_AGENT_TEMP_MODEL?.trim() || 'default-model',
    provider,
    baseUrl: process.env.AI_AGENT_TEMP_BASE_URL?.trim() ?? '',
  };
}
