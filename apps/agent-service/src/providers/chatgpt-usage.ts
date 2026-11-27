import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CHATGPT_PRIVACY_VERSION,
  CHATGPT_USAGE_LIMIT_ERRORS,
  chatgptUsageError,
  type ChatGPTConsentRequest,
  type ChatGPTUsageError,
  type ChatGPTUsageLimitError,
  type ServiceConnection,
} from '@atd/agent-contracts';
import type { ProviderStores } from './runtime.js';
import { ConflictError } from '../errors.js';

const background = new AsyncLocalStorage<boolean>();
const paused = new Map<string, ChatGPTUsageLimitError>();
const pauseReasons = new Map<string, ChatGPTUsageLimitError>();

function isChatGPTLimitError(code: ChatGPTUsageError | undefined): code is ChatGPTUsageLimitError {
  return (
    code !== undefined &&
    (CHATGPT_USAGE_LIMIT_ERRORS as readonly ChatGPTUsageError[]).includes(code)
  );
}

/**
 * Carry execution intent through streamed requests, tool calls and child-agent work. Only a
 * known user action may opt out of background consent; an unclassified entry stays guarded.
 */
export function withInferencePurpose<T>(isBackground: boolean, action: () => T): T {
  return background.run(isBackground, action);
}

export function isChatGPT(connection: Pick<ServiceConnection, 'provider' | 'authType'>): boolean {
  return connection.provider === 'openai' && connection.authType === 'oauth';
}

export function recordChatGPTConsent(
  connection: ServiceConnection,
  consent: ChatGPTConsentRequest | undefined,
): void {
  if (!consent) return;
  if (!isChatGPT(connection)) throw new TypeError('ChatGPT consent requires a ChatGPT connection.');
  connection.chatgptConsent = { ...consent, acceptedAt: new Date().toISOString() };
}

export function requireChatGPTNotice(connection: ServiceConnection): void {
  if (
    isChatGPT(connection) &&
    connection.chatgptConsent?.privacyVersion !== CHATGPT_PRIVACY_VERSION
  )
    throw new ConflictError(
      'chatgpt_privacy_required: Review the ChatGPT privacy notice in connection settings.',
    );
}

/** Recheck live permissions for each inference, including on runtimes held by idle sessions. */
export function chatgptUsage(stores: ProviderStores, selected: ServiceConnection) {
  return {
    async check() {
      await stores.connections.reload();
      const live = stores.connections.connection(selected.connectionId);
      if (!live.connected || live.configurationId !== selected.configurationId)
        throw new Error('The ChatGPT connection changed. Reconnect it in Settings.');
      requireChatGPTNotice(live);
      if (!live.chatgptPlanEnabled)
        throw new Error(
          'chatgpt_plan_disabled: Sign-in succeeded. Enable ChatGPT plan usage in connection settings.',
        );
      if (background.getStore() !== false && !live.chatgptConsent?.backgroundAllowed)
        throw new Error(
          'chatgpt_background_consent_required: Allow background use in this ChatGPT connection’s settings.',
        );
      const activePause = paused.get(live.connectionId);
      if (live.chatgptUsagePaused || activePause) {
        const code =
          activePause ??
          live.chatgptUsagePauseReason ??
          pauseReasons.get(live.connectionId) ??
          'subscription_sharing_usage_limit_exceeded';
        throw new Error(
          code === 'subscription_sharing_workplace_individual_usage_limit_exceeded'
            ? 'subscription_sharing_workplace_individual_usage_limit_exceeded: Requests are paused. Ask your workspace admin to review usage limits, then resume in connection settings.'
            : 'subscription_sharing_usage_limit_exceeded: Requests are paused. Review usage, then resume in connection settings.',
        );
      }
      pauseReasons.delete(live.connectionId);
    },
    async failed(this: void, message: string) {
      const code = chatgptUsageError(message);
      if (!isChatGPTLimitError(code)) return;
      paused.set(selected.connectionId, code);
      pauseReasons.set(selected.connectionId, code);
      try {
        await stores.connections.change((data) => {
          const live = data.connections.find((item) => item.connectionId === selected.connectionId);
          if (
            live?.connected &&
            live.configurationId === selected.configurationId &&
            (!live.chatgptUsagePaused || live.chatgptUsagePauseReason !== code)
          ) {
            live.chatgptUsagePaused = true;
            live.chatgptUsagePauseReason = code;
            live.revision += 1;
          }
        });
        paused.delete(selected.connectionId);
      } catch {
        // Keep the in-process stop even if persistence fails; preserve the upstream diagnostic.
      }
    },
  };
}

export function resumeChatGPTUsage(connectionId: string): void {
  paused.delete(connectionId);
  pauseReasons.delete(connectionId);
}
