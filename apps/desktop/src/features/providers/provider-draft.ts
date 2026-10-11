import type { Connection, ConnectionDraft } from '../../client/providers/schema';
import { CHATGPT_PRIVACY_VERSION } from '@atd/agent-contracts';

/** Keep the saved revision with editable settings so saving preserves conflict detection. */
export function draftFrom(connection: Connection): ConnectionDraft {
  const {
    connectionId,
    revision,
    provider,
    name,
    baseUrl,
    authType,
    defaultModel,
    defaultThinkingLevel,
    options,
    customModels,
  } = connection;
  return {
    connectionId,
    expectedRevision: revision,
    provider,
    name,
    baseUrl,
    authType,
    defaultModel,
    ...(defaultThinkingLevel === undefined ? {} : { defaultThinkingLevel }),
    ...(connection.chatgptConsent?.privacyVersion === CHATGPT_PRIVACY_VERSION
      ? {
          chatgptConsent: {
            privacyVersion: CHATGPT_PRIVACY_VERSION,
            backgroundAllowed: connection.chatgptConsent.backgroundAllowed,
          },
        }
      : {}),
    options,
    customModels,
  };
}
