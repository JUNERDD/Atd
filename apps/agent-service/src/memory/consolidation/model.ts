import { randomUUID } from 'node:crypto';
import type { ModelSelection, ThinkingLevel } from '@atd/agent-contracts';
import { clampThinkingLevel, type Api, type Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ConnectionStore } from '../../credentials/connections.js';
import { KeyringBackend } from '../../credentials/keyring.js';
import { connectionRuntime, type ProviderStores } from '../../providers/runtime.js';
import { readServiceId, type ServicePaths } from '../../storage.js';
import { replyChannel, type LearnerReply } from '../learner/ops.js';
import { CONSOLIDATION_SYSTEM_PROMPT } from './prompts.js';

/** The model a consolidation calls once, without tools or a session. */
export interface ConsolidationModel {
  models: Pick<ModelRuntime, 'completeSimple'>;
  model: Model<Api>;
}

/** The model for a selection (absent: the default connection's default model), or why none. */
export type OpenModel = (
  selection: ModelSelection | undefined,
) => Promise<ConsolidationModel | { unavailable: string }>;

/** Room for a few rewritten bodies; a longer reply is cut and fails to parse. */
const CONSOLIDATION_MAX_TOKENS = 8192;
/** The one model call, on top of the request's own signal. */
export const CONSOLIDATION_TIMEOUT_MS = 180_000;

const CONNECT = 'Connect a model provider in Settings → Providers first.';

/**
 * Opens models on the saved provider connections, like apps' `ai.generate`
 * (apps/capabilities/ai.ts): the selected connection and model, else the default connection's
 * default model. Credentials stay in this process. The operator's temporary credentials
 * (`AI_AGENT_TEMP_*`) serve task runs only, so a consolidation without a saved connection has no
 * model.
 */
export function connectionModels(paths: ServicePaths): OpenModel {
  return async (selection) => {
    const connections = await ConnectionStore.load(paths.root);
    const connectionId = selection?.connectionId ?? connections.data.defaultConnectionId;
    const connection = connections.data.connections.find(
      (item) => item.connectionId === connectionId,
    );
    if (!connection?.connected) return { unavailable: CONNECT };
    const modelId = selection?.modelId ?? connection.defaultModel;
    if (!modelId) return { unavailable: `${connection.name} has no default model.` };
    const stores: ProviderStores = {
      dataDir: paths.root,
      connections,
      keyring: new KeyringBackend(await readServiceId(paths)),
    };
    const models = await connectionRuntime(stores, connection);
    const model = models.getModel(connection.provider, modelId);
    if (!model) return { unavailable: `${modelId} is unavailable on ${connection.name}.` };
    if (!(await models.checkAuth(connection.provider)))
      return { unavailable: `${connection.name} has no usable credentials.` };
    return { models, model };
  };
}

/**
 * The consolidation's one completion: its own session id (providers that route by session read
 * it), a bounded reply, thinking only when the automation asks for it, and a timeout on top of
 * `signal`. Rejects when the call fails or is aborted.
 */
export async function completeConsolidation(
  source: ConsolidationModel,
  prompt: string,
  thinking: ThinkingLevel | undefined,
  signal: AbortSignal,
): Promise<LearnerReply> {
  const level = thinking === undefined ? 'off' : clampThinkingLevel(source.model, thinking);
  const result = await source.models.completeSimple(
    source.model,
    {
      systemPrompt: CONSOLIDATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    },
    {
      maxTokens: Math.min(CONSOLIDATION_MAX_TOKENS, source.model.maxTokens),
      sessionId: randomUUID(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(CONSOLIDATION_TIMEOUT_MS)]),
      ...(level === 'off' ? {} : { reasoning: level }),
    },
  );
  if (result.stopReason === 'error' || result.stopReason === 'aborted')
    throw new Error(result.errorMessage ?? `The consolidation call ended: ${result.stopReason}.`);
  return replyChannel(result.content);
}
