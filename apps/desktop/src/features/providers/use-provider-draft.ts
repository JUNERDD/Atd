import { useState } from 'react';
import type {
  Connection,
  ConnectionDraft,
  ProviderCatalogEntry,
} from '../../client/providers/schema';
import { useSettingsUnsavedChanges } from '../settings/settings-unsaved-changes';
import { draftFrom } from './provider-draft';

/**
 * An edit to a provider form's draft. `undefined` on an optional setting removes it: a dropped API
 * key keeps the stored credential, and a dropped thinking level follows the model.
 */
export type ConnectionDraftPatch = Partial<
  Omit<ConnectionDraft, 'apiKey' | 'defaultThinkingLevel' | 'chatgptConsent'>
> & {
  apiKey?: string | undefined;
  chatgptConsent?: ConnectionDraft['chatgptConsent'] | undefined;
  defaultThinkingLevel?: NonNullable<ConnectionDraft['defaultThinkingLevel']> | undefined;
};

/**
 * Applies a patch, keeping the draft's key order: the unsaved-changes check compares the drafts
 * as JSON, which a reordered but equal draft must not fail.
 */
function patchDraft(draft: ConnectionDraft, patch: ConnectionDraftPatch): ConnectionDraft {
  const { apiKey, defaultThinkingLevel, chatgptConsent, ...settings } = patch;
  const next: ConnectionDraft = { ...draft, ...settings };
  if (apiKey !== undefined) next.apiKey = apiKey;
  else if ('apiKey' in patch) delete next.apiKey;
  if (defaultThinkingLevel !== undefined) next.defaultThinkingLevel = defaultThinkingLevel;
  else if ('defaultThinkingLevel' in patch) delete next.defaultThinkingLevel;
  if (chatgptConsent !== undefined) next.chatgptConsent = chatgptConsent;
  else if ('chatgptConsent' in patch) delete next.chatgptConsent;
  return next;
}

/**
 * A provider form's draft and whether it holds unsaved changes, which the settings window asks
 * about before leaving the form. The baseline is the draft as last loaded or saved.
 */
export function useProviderDraft(provider: ProviderCatalogEntry, connection: Connection | null) {
  const [baseline, setBaseline] = useState<ConnectionDraft>(() =>
    connection
      ? draftFrom(connection)
      : {
          connectionId: null,
          expectedRevision: null,
          provider: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          authType: provider.auth[0]?.type ?? 'api_key',
          defaultModel: '',
          options: {},
          customModels: [],
        },
  );
  const [draft, setDraft] = useState<ConnectionDraft>(baseline);
  // An emptied key field means nothing until a key is saved, so it only counts once one is.
  const comparable =
    draft.apiKey === '' && !connection?.hasCredential ? { ...draft, apiKey: undefined } : draft;
  const dirty = JSON.stringify(comparable) !== JSON.stringify(baseline);
  useSettingsUnsavedChanges(dirty);

  if (!dirty && connection && connection.connectionId === baseline.connectionId) {
    const saved = draftFrom(connection);
    // Sign-in and credential refresh advance the saved revision. An untouched form can follow
    // it immediately; an edited draft keeps its revision so a concurrent save still conflicts.
    if (JSON.stringify(saved) !== JSON.stringify(baseline)) {
      setBaseline(saved);
      setDraft(saved);
    }
  }

  return {
    draft,
    dirty,
    /** Applies the user's edit. */
    change: (patch: ConnectionDraftPatch) => setDraft(patchDraft(draft, patch)),
    /** Replaces the draft with a loaded or saved one, which becomes the unchanged state. */
    load: (next: ConnectionDraft) => {
      setBaseline(next);
      setDraft(next);
    },
  };
}
