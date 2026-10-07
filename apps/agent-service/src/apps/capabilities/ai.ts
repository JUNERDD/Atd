import { randomUUID } from 'node:crypto';
import type { Api, AssistantMessage, Message, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AiGenerateInput, AiGenerateOutput, ServiceConnection } from '@atd/agent-contracts';
import { ConnectionStore } from '../../credentials/connections.js';
import { KeyringBackend } from '../../credentials/keyring.js';
import { connectionRuntime, type ProviderStores } from '../../providers/runtime.js';
import { readServiceId, type ServicePaths } from '../../storage.js';
import { AppFailure } from '../errors.js';

/** Default answer budget when the app names none. */
const DEFAULT_MAX_TOKENS = 4096;

const noProvider = () =>
  new AppFailure(409, 'auth_required', 'Connect a model provider in Settings → Providers first.');

/**
 * The connection serving `modelId`: the default connection when it offers the model (or when no
 * model is named), else the first other connected one that lists it. Credentials stay in this
 * process; the app only ever sees text.
 */
function pickConnection(store: ConnectionStore, modelId: string | undefined): ServiceConnection {
  const connected = store.data.connections.filter((item) => item.connected);
  const fallback = connected.find((item) => item.connectionId === store.data.defaultConnectionId);
  if (!modelId) {
    if (!fallback?.defaultModel) throw noProvider();
    return fallback;
  }
  const offers = (connection: ServiceConnection) =>
    connection.defaultModel === modelId ||
    [...(connection.catalog ?? []), ...(connection.customModels ?? [])].some(
      (model) => model.id === modelId,
    );
  const match = (fallback && offers(fallback) ? fallback : undefined) ?? connected.find(offers);
  if (!match) throw new AppFailure(404, 'not_found', `No connected provider offers ${modelId}.`);
  return match;
}

async function openModel(
  paths: ServicePaths,
  modelId: string | undefined,
): Promise<{ runtime: ModelRuntime; model: Model<Api> }> {
  const connections = await ConnectionStore.load(paths.root);
  const connection = pickConnection(connections, modelId);
  const stores: ProviderStores = {
    dataDir: paths.root,
    connections,
    keyring: new KeyringBackend(await readServiceId(paths)),
  };
  const runtime = await connectionRuntime(stores, connection);
  const id = modelId ?? connection.defaultModel;
  const model = id ? runtime.getModel(connection.provider, id) : undefined;
  if (!model) throw new AppFailure(404, 'not_found', `${id} is unavailable on ${connection.name}.`);
  if (!(await runtime.checkAuth(connection.provider))) throw noProvider();
  return { runtime, model };
}

/** The app's messages as Pi messages; earlier answers become assistant turns of this model. */
function piMessages(input: AiGenerateInput, model: Model<Api>): Message[] {
  const timestamp = Date.now();
  return input.messages.map((message): Message => {
    if (message.role === 'user') return { role: 'user', content: message.content, timestamp };
    const answer: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: message.content }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp,
    };
    return answer;
  });
}

function output(message: AssistantMessage, model: Model<Api>): AiGenerateOutput {
  if (message.stopReason === 'error' || message.stopReason === 'aborted')
    throw new AppFailure(
      502,
      message.stopReason === 'aborted' ? 'cancelled' : 'upstream_failed',
      message.errorMessage ?? 'The model request failed.',
    );
  return {
    text: message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
    model: model.id,
    usage: { inputTokens: message.usage.input, outputTokens: message.usage.output },
  };
}

/**
 * `ai.generate` and `ai.stream`: one model request on the user's default connection and model
 * (or the connection offering `input.model`), without tools. `onDelta` streams the answer text.
 */
export async function generate(
  paths: ServicePaths,
  input: AiGenerateInput,
  signal: AbortSignal,
  onDelta?: (delta: string) => void,
): Promise<AiGenerateOutput> {
  const { runtime, model } = await openModel(paths, input.model);
  const context = {
    ...(input.system ? { systemPrompt: input.system } : {}),
    messages: piMessages(input, model),
  };
  const options = {
    maxTokens: Math.min(input.maxTokens ?? DEFAULT_MAX_TOKENS, model.maxTokens),
    signal,
    // Each app request is its own conversation; providers that route by session read this id.
    sessionId: randomUUID(),
  };
  if (!onDelta) return output(await runtime.completeSimple(model, context, options), model);
  const stream = runtime.streamSimple(model, context, options);
  for await (const event of stream) {
    if (event.type === 'text_delta') onDelta(event.delta);
    else if (event.type === 'done') return output(event.message, model);
    else if (event.type === 'error') return output(event.error, model);
  }
  return output(await stream.result(), model);
}
