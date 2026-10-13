import { Type } from 'typebox';
import {
  lazyStream,
  type Api,
  type Provider,
  type OAuthAuth,
  type AssistantMessageEvent,
} from '@earendil-works/pi-ai';
import { parse, type ServiceModelDefinition } from '@atd/agent-contracts';
import { CHATGPT_RESOURCE } from './chatgpt-oauth.js';
import type { chatgptUsage } from './chatgpt-usage.js';
import { chatgptHttpError, chatgptTransport } from './chatgpt-http.js';
import { chatgptPayload } from './chatgpt-payload.js';
import { CatalogFailure } from './catalog-http.js';

const CatalogSchema = Type.Object({
  models: Type.Array(
    Type.Object({
      slug: Type.String({ minLength: 1, maxLength: 256 }),
      display_name: Type.String({ minLength: 1, maxLength: 256 }),
      visibility: Type.String(),
    }),
    { maxItems: 5000 },
  ),
});

/** Only the service's authenticated account catalog defines models for a SIWC connection. */
export function chatgptProvider(
  base: Provider,
  oauth: OAuthAuth,
  catalog: readonly ServiceModelDefinition[],
  usage: ReturnType<typeof chatgptUsage>,
): Provider {
  const known = new Map(base.getModels().map((model) => [model.id, model]));
  const models = catalog.flatMap((entry) => {
    const model = known.get(entry.id);
    return model && entry.api === 'openai-responses' && entry.baseUrl === CHATGPT_RESOURCE
      ? [{ ...model, ...entry, provider: 'openai' }]
      : [];
  });
  const provider = {
    ...base,
    auth: { oauth },
    baseUrl: CHATGPT_RESOURCE,
    getModels: () => models,
    getAllModels: () => models,
    stream: (model, context, options) =>
      lazyStream(model, async () => {
        await usage.check();
        const transport = chatgptTransport(usage, options?.fetch);
        return observe(
          base.stream<Api>(model, context, {
            ...options,
            maxRetries: 0,
            fetch: transport.request,
            onPayload: chatgptPayload(options?.onPayload),
          }),
          usage.failed,
          transport.diagnostic,
        );
      }),
    streamSimple: (model, context, options) =>
      lazyStream(model, async () => {
        await usage.check();
        const transport = chatgptTransport(usage, options?.fetch);
        return observe(
          base.streamSimple(model, context, {
            ...options,
            maxRetries: 0,
            fetch: transport.request,
            onPayload: chatgptPayload(options?.onPayload),
          }),
          usage.failed,
          transport.diagnostic,
        );
      }),
  } satisfies Provider;
  // Pi's API-key catalog/cache is not an authorization list for a ChatGPT account. The service
  // refreshes this catalog explicitly, so registerNativeProvider's background refresh cannot
  // replace it with a generic directory or race an account catalog publication.
  delete provider.refreshModels;
  return provider;
}

async function* observe(
  events: AsyncIterable<AssistantMessageEvent>,
  failed: (message: string) => Promise<void>,
  diagnostic: () => string | undefined,
): AsyncIterable<AssistantMessageEvent> {
  for await (const event of events) {
    if (event.type === 'error') {
      const reason = diagnostic();
      if (reason) event.error.errorMessage = reason;
      else await failed(event.error.errorMessage ?? '');
    }
    yield event;
  }
}

/** Preserve the account's list order and use Pi metadata only for models it can encode. */
export async function loadChatGPTModels(
  known: readonly ServiceModelDefinition[],
  access: string,
  signal: AbortSignal,
): Promise<ServiceModelDefinition[]> {
  const response = await fetch(`${CHATGPT_RESOURCE}/models`, {
    headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
    signal,
    redirect: 'error',
  });
  if (!response.ok) throw new CatalogFailure(await chatgptHttpError(response));
  const catalog = parse(CatalogSchema, await response.json());
  const definitions = new Map(known.map((model) => [model.id, model]));
  return catalog.models.flatMap((entry) => {
    const model = definitions.get(entry.slug);
    return entry.visibility === 'list' && model
      ? [{ ...model, name: entry.display_name, baseUrl: CHATGPT_RESOURCE, api: 'openai-responses' }]
      : [];
  });
}
