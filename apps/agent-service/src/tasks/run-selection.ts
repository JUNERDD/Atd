import {
  runModelSelection,
  type ModelSelection,
  type RunModelSources,
  type ServiceModel,
  type ThinkingLevel,
} from '@atd/agent-contracts';
import type { ConnectionStore } from '../credentials/connections.js';
import { LedgerNotFound } from '../ledger.js';
import { presentConnection } from '../providers/connection-view.js';
import { effectiveContextWindow } from '../providers/context-tiers.js';

/** Connection id of runs on the operator's environment-injected credentials. */
export const TEMP_CONNECTION_ID = 'temp';

/**
 * The selection a run of these sources asks for (`runModelSelection`), checked against the saved
 * connections. Preview and submit both choose through this before `resolveRunModel` pins it.
 */
export function selectRunModel(
  connections: ConnectionStore,
  sources: Omit<RunModelSources, 'hasConnection'>,
): ModelSelection | undefined {
  return runModelSelection({
    ...sources,
    hasConnection: (connectionId) =>
      connections.data.connections.some((item) => item.connectionId === connectionId),
  });
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
 * The requested level, else the level saved on the run's connection; absent
 * runs with reasoning off. Pi clamps it to the model when the run starts.
 */
export function resolveRunThinkingLevel(
  connections: ConnectionStore,
  model: ServiceModel,
  requested: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  return (
    requested ??
    connections.data.connections.find((item) => item.connectionId === model.connectionId)
      ?.defaultThinkingLevel
  );
}

/** Resolves the context window a run of a model freezes; undefined keeps the catalog window. */
export type RunContextWindow = (model: ServiceModel) => number | undefined;

/**
 * Loads what `RunContextWindow` needs for the connection a selection (else the default) names:
 * its presented catalog and saved tiers. Submit loads it before acceptance, so the freeze itself
 * stays synchronous; a model on another connection, or the temp connection, gets no window.
 */
export async function loadRunContextWindow(
  connections: ConnectionStore,
  selection: ModelSelection | undefined,
): Promise<RunContextWindow> {
  const connectionId = selection?.connectionId ?? connections.data.defaultConnectionId;
  const connection = connections.data.connections.find(
    (item) => item.connectionId === connectionId,
  );
  if (!connection) return () => undefined;
  const { catalog = [] } = await presentConnection(connection);
  return (model) =>
    model.connectionId === connection.connectionId
      ? effectiveContextWindow(connection, catalog, model.modelId)
      : undefined;
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
