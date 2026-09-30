import { useState } from 'react';
import type {
  Connection,
  ConnectionDraft,
  ProviderCatalogEntry,
} from '../../client/providers/schema';
import { useSettingsUnsavedChanges } from '../settings/settings-unsaved-changes';
import { draftFrom } from './provider-draft';

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
  useSettingsUnsavedChanges(JSON.stringify(comparable) !== JSON.stringify(baseline));

  return {
    draft,
    /** Applies the user's edit. */
    change: (patch: Partial<ConnectionDraft>) => setDraft({ ...draft, ...patch }),
    /** Replaces the draft with a loaded or saved one, which becomes the unchanged state. */
    load: (next: ConnectionDraft) => {
      setBaseline(next);
      setDraft(next);
    },
    /**
     * Applies a correction the form makes itself, such as dropping a reasoning level the model
     * does not offer. On the baseline's own model that is how the connection opens, not an edit.
     */
    normalize: (patch: Partial<ConnectionDraft>) => {
      setDraft((current) => ({ ...current, ...patch }));
      setBaseline((current) =>
        current.defaultModel === draft.defaultModel ? { ...current, ...patch } : current,
      );
    },
  };
}
