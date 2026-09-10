import { useState } from 'react';
import type {
  ProviderDraft,
  ProviderId,
  ProviderSettings,
} from '../../../electron/settings-contract';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const EMPTY_PROVIDER: ProviderSettings = {
  id: 'openai',
  baseUrl: OPENAI_BASE_URL,
  model: '',
  hasApiKey: false,
};

interface ProviderRequest {
  kind: 'testing' | 'saving';
}

interface ProviderFormState {
  source: ProviderSettings | null;
  saved: ProviderSettings;
  draft: ProviderDraft;
  models: string[];
  pending: ProviderRequest | null;
  error: string;
  status: string;
  notice: string;
}

function editableProvider(provider: ProviderSettings): ProviderDraft {
  return { id: provider.id, baseUrl: provider.baseUrl, model: provider.model };
}

function endpointIdentity(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    return new URL(trimmed).href.replace(/\/+$/, '');
  } catch {
    // This compares edits only; the native boundary still validates the URL.
    return trimmed;
  }
}

function isDirty(draft: ProviderDraft, saved: ProviderSettings): boolean {
  return (
    draft.id !== saved.id ||
    endpointIdentity(draft.baseUrl) !== endpointIdentity(saved.baseUrl) ||
    draft.model !== saved.model ||
    draft.apiKey !== undefined
  );
}

function sameProvider(left: ProviderSettings, right: ProviderSettings): boolean {
  return (
    left.id === right.id &&
    left.baseUrl === right.baseUrl &&
    left.model === right.model &&
    left.hasApiKey === right.hasApiKey
  );
}

function reconcileProvider(
  state: ProviderFormState,
  provider: ProviderSettings,
): ProviderFormState {
  if (sameProvider(provider, state.saved)) return { ...state, source: provider };
  const dirty = isDirty(state.draft, state.saved);
  const updated = {
    ...state,
    source: provider,
    saved: provider,
    notice: dirty
      ? 'Saved provider settings changed while you were editing. Your draft is preserved.'
      : '',
  };
  // The save response completes the same mutation whose broadcast may arrive first.
  if (state.pending?.kind === 'saving') return updated;
  const connectionChanged =
    endpointIdentity(provider.baseUrl) !== endpointIdentity(state.saved.baseUrl) ||
    provider.hasApiKey !== state.saved.hasApiKey;
  return {
    ...updated,
    draft: dirty ? state.draft : editableProvider(provider),
    models:
      state.pending?.kind === 'testing' ||
      (connectionChanged && (!dirty || state.draft.apiKey === undefined))
        ? []
        : state.models,
    pending: null,
    error: '',
    status: '',
  };
}

export function useProviderSettings(provider: ProviderSettings | null) {
  const bridge = window.desktop?.settings;
  const [state, setState] = useState<ProviderFormState>(() => {
    const saved = provider ?? EMPTY_PROVIDER;
    return {
      source: provider,
      saved,
      draft: editableProvider(saved),
      models: [],
      pending: null,
      error: '',
      status: '',
      notice: '',
    };
  });
  if (provider && provider !== state.source) setState(reconcileProvider(state, provider));

  const { saved, draft, models } = state;
  const endpointChanged = endpointIdentity(draft.baseUrl) !== endpointIdentity(saved.baseUrl);
  const dirty = isDirty(draft, saved);
  const disabled = !provider || !bridge || state.pending !== null;

  function changeProvider(id: ProviderId) {
    if (id === draft.id) return;
    const baseUrl = id === 'openai' ? OPENAI_BASE_URL : '';
    changeEndpoint(baseUrl, id);
  }

  function changeEndpoint(baseUrl: string, id: ProviderId) {
    setState((current) => {
      const changed = endpointIdentity(baseUrl) !== endpointIdentity(current.draft.baseUrl);
      return {
        ...current,
        draft: { ...current.draft, id, baseUrl, model: changed ? '' : current.draft.model },
        ...(changed ? { models: [], error: '', status: '' } : {}),
      };
    });
  }

  function changeBaseUrl(baseUrl: string) {
    // Omission preserves the key; native validation rejects retaining it at a different endpoint.
    changeEndpoint(baseUrl, draft.id);
  }

  function changeApiKey(apiKey: string | undefined) {
    setState((current) => ({
      ...current,
      draft: {
        ...current.draft,
        apiKey,
        model: apiKey === undefined && !endpointChanged ? current.saved.model : '',
      },
      models: [],
      error: '',
      status: '',
    }));
  }

  function changeModel(model: string) {
    if (!models.includes(model)) return;
    setState((current) => ({
      ...current,
      draft: { ...current.draft, model },
      error: '',
      status: '',
    }));
  }

  async function testConnection() {
    if (disabled || !bridge) return;
    const request: ProviderRequest = { kind: 'testing' };
    setState((current) => ({ ...current, pending: request, error: '', status: '', models: [] }));
    try {
      const result = await bridge.testProvider(draft);
      const availableModels = [...new Set(result.models)];
      setState((current) =>
        current.pending !== request
          ? current
          : {
              ...current,
              pending: null,
              models: availableModels,
              draft: {
                ...current.draft,
                model: availableModels.includes(current.draft.model) ? current.draft.model : '',
              },
              status:
                availableModels.length > 0
                  ? 'Connection successful. Choose a default model.'
                  : 'Connected. This provider returned no models.',
            },
      );
    } catch (reason) {
      setState((current) =>
        current.pending !== request
          ? current
          : {
              ...current,
              pending: null,
              error: reason instanceof Error ? reason.message : 'The connection test failed.',
            },
      );
    }
  }

  async function saveChanges() {
    if (disabled || !bridge || !dirty) return;
    const request: ProviderRequest = { kind: 'saving' };
    setState((current) => ({ ...current, pending: request, error: '', status: '' }));
    try {
      const result = await bridge.saveProvider(draft);
      setState((current) =>
        current.pending !== request
          ? current
          : {
              ...current,
              pending: null,
              saved: result.provider,
              draft: editableProvider(result.provider),
              notice: '',
              status: 'Changes saved.',
            },
      );
    } catch (reason) {
      setState((current) =>
        current.pending !== request
          ? current
          : {
              ...current,
              pending: null,
              error:
                reason instanceof Error ? reason.message : 'Provider settings could not be saved.',
            },
      );
    }
  }

  return {
    draft,
    models,
    pending: state.pending?.kind ?? null,
    error: state.error,
    status: state.status,
    notice: state.notice,
    dirty,
    disabled,
    hasStoredKey: saved.hasApiKey,
    endpointChanged,
    changeProvider,
    changeBaseUrl,
    changeApiKey,
    changeModel,
    testConnection,
    saveChanges,
  };
}
