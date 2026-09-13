import type { Connection, ConnectionDraft } from '../../../electron/providers/schema';

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
    options,
    customModels,
  };
}
