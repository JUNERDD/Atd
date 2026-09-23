import type { ModelSelection, ServiceModel, ThinkingLevel } from '@ai/agent-contracts';
import type { ConnectionStore } from '../credentials/connections.js';
import { LedgerNotFound } from '../ledger.js';

/** Connection id of runs on the operator's environment-injected credentials. */
export const TEMP_CONNECTION_ID = 'temp';

/**
 * Pins the model a run uses: the requested connection and model, else the
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
