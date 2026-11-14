import { randomUUID } from 'node:crypto';
import { withInferencePurpose } from '../../providers/chatgpt-usage.js';
import { inferenceError } from '../../providers/inference-result.js';
import {
  findModelAlias,
  resolveAliasDefaults,
  type ModelSelection,
  type RunContextChoice,
  type ThinkingLevel,
} from '@atd/agent-contracts';
import { clampThinkingLevel, type Api, type Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ConnectionStore } from '../../credentials/connections.js';
import { KeyringBackend } from '../../credentials/keyring.js';
import { presentConnection } from '../../providers/connection-view.js';
import type { ContextOverride } from '../../providers/context-override.js';
import { resolveRunContextWindow } from '../../providers/context-tiers.js';
import { connectionRuntime, type ProviderStores } from '../../providers/runtime.js';
import { readServiceId, type ServicePaths } from '../../storage.js';
import { replyChannel, type LearnerReply } from '../learner/ops.js';
import { CONSOLIDATION_SYSTEM_PROMPT } from './prompts.js';

/** The model a consolidation calls once, without tools or a session. */
export interface ConsolidationModel {
  models: Pick<ModelRuntime, 'completeSimple'>;
  model: Model<Api>;
}

/** The model for a selection (absent: the default alias or default connection's default model), or why none. */
export type OpenModel = (
  selection: ModelSelection | undefined,
  contextChoice?: RunContextChoice,
) => Promise<ConsolidationModel | { unavailable: string }>;

/** Room for a few rewritten bodies; a longer reply is cut and fails to parse. */
const CONSOLIDATION_MAX_TOKENS = 8192;
/** The one model call, on top of the request's own signal. */
export const CONSOLIDATION_TIMEOUT_MS = 180_000;

const CONNECT = 'Connect a model provider in Settings → Providers first.';

/**
 * Opens models on the saved provider connections, like apps' `ai.generate`
 * (apps/capabilities/ai.ts): the selected connection and model, else the default alias's model (if
 * connected), else the default connection's default model. Credentials stay in this process. The
 * operator's temporary credentials (`AI_AGENT_TEMP_*`) serve task runs only, so a consolidation
 * without a saved connection has no model.
 */
export function connectionModels(paths: ServicePaths): OpenModel {
  return async (selection, contextChoice) => {
    const connections = await ConnectionStore.load(paths.root);
    const defaultAlias =
      selection === undefined
        ? findModelAlias(connections.data.aliases, connections.data.defaultAliasId ?? undefined)
        : undefined;
    const aliasUsable =
      defaultAlias &&
      connections.data.connections.some(
        (item) => item.connectionId === defaultAlias.connectionId && item.connected,
      )
        ? resolveAliasDefaults(defaultAlias)
        : undefined;
    const effectiveSelection = selection ?? aliasUsable?.model;
    const effectiveChoice = contextChoice ?? aliasUsable?.contextChoice;
    const connectionId = effectiveSelection?.connectionId ?? connections.data.defaultConnectionId;
    const connection = connections.data.connections.find(
      (item) => item.connectionId === connectionId,
    );
    if (!connection?.connected) return { unavailable: CONNECT };
    const modelId = effectiveSelection?.modelId ?? connection.defaultModel;
    if (!modelId) return { unavailable: `${connection.name} has no default model.` };
    const { catalog = [] } = await presentConnection(connection);
    const definition = catalog.find((item) => item.id === modelId);
    const resolvedWindow = resolveRunContextWindow(
      effectiveChoice,
      connection,
      modelId,
      definition?.contextWindow,
      catalog,
    );
    const maxTokens =
      resolvedWindow && definition && definition.maxTokens > resolvedWindow
        ? resolvedWindow
        : undefined;
    const contextOverride: ContextOverride | undefined =
      resolvedWindow && (definition?.contextWindow !== resolvedWindow || maxTokens !== undefined)
        ? { modelId, contextWindow: resolvedWindow, ...(maxTokens ? { maxTokens } : {}) }
        : undefined;
    const stores: ProviderStores = {
      dataDir: paths.root,
      connections,
      keyring: new KeyringBackend(await readServiceId(paths)),
    };
    const models = await connectionRuntime(stores, connection, undefined, contextOverride);
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
 * `signal`. Rejects when the call fails, is aborted or returns a truncated response.
 */
export async function completeConsolidation(
  source: ConsolidationModel,
  prompt: string,
  thinking: ThinkingLevel | undefined,
  signal: AbortSignal,
): Promise<LearnerReply> {
  const level = thinking === undefined ? 'off' : clampThinkingLevel(source.model, thinking);
  const result = await withInferencePurpose(true, () =>
    source.models.completeSimple(
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
    ),
  );
  const error = inferenceError(result);
  if (error) throw new Error(error);
  return replyChannel(result.content);
}
