import { useEffect, useState } from 'react';
import type { ContextTier, ModelContexts, ModelReference } from '../../client/providers/schema';
import { showErrorToast } from '../../components/toast-store';
import i18n from '../../i18n';
import { useServiceStatus } from '../service/use-service';

const NONE: ModelContexts = { options: [], defaultTier: null, selected: null };

/** One request per connection revision and model; concurrent consumers share it. */
const pending = new Map<string, Promise<ModelContexts>>();

/**
 * The model's tiers from the main process. Never rejects to the caller: a missing bridge, an
 * unknown model, or a failed request all resolve to no tiers, which keeps the Context row
 * read-only.
 */
function loadContexts(reference: ModelReference, revision: number): Promise<ModelContexts> {
  const key = `${reference.connectionId}:${reference.modelId}:${revision}`;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const bridge = window.desktop?.settings.providers;
  const request = bridge ? bridge.contexts(reference).catch(() => NONE) : Promise.resolve(NONE);
  pending.set(key, request);
  void request.finally(() => pending.delete(key));
  return request;
}

export interface ModelContextChoice {
  /** Both tiers when the model offers a real choice (`standard` first); otherwise empty. */
  options: ModelContexts['options'];
  /** The tier later runs of this model use; null without tiers. */
  selected: ContextTier | null;
  /** The selected tier's window, null without tiers (callers fall back to the catalog window). */
  window: number | null;
  loading: boolean;
}

/**
 * Context tiers for one model selection, requested while the service is connected. The saved tier
 * lives on the connection, so a new connection `revision` (after a tier write, or any other edit)
 * asks again; the previous answer stays shown meanwhile so the trigger does not flicker.
 */
export function useModelContexts(
  reference: ModelReference | null,
  revision: number | null,
): ModelContextChoice {
  const connectionId = reference?.connectionId ?? null;
  const modelId = reference?.modelId ?? null;
  const connected = useServiceStatus().status?.state === 'connected';
  const key =
    connected && connectionId && modelId && revision ? `${connectionId}:${modelId}` : null;
  const [answers, setAnswers] = useState<
    ReadonlyMap<string, { revision: number; contexts: ModelContexts }>
  >(() => new Map());
  useEffect(() => {
    if (!connected || !connectionId || !modelId || !revision) return;
    const requested = `${connectionId}:${modelId}`;
    let active = true;
    void loadContexts({ connectionId, modelId }, revision).then((contexts) => {
      if (active) setAnswers((current) => new Map(current).set(requested, { revision, contexts }));
    });
    return () => {
      active = false;
    };
  }, [connected, connectionId, modelId, revision]);
  const answer = key ? answers.get(key) : undefined;
  const contexts = answer?.contexts ?? NONE;
  const selected = contexts.options.find((option) => option.tier === contexts.selected);
  return {
    options: contexts.options.length === 2 ? contexts.options : [],
    selected: contexts.selected,
    window: selected?.contextWindow ?? null,
    loading: Boolean(key) && answer?.revision !== revision,
  };
}

/**
 * Saves a model's tier on its connection. Failures (a stale revision, a lost service) show as an
 * error toast; the settings snapshot that follows every write refreshes the shown tier either way.
 */
export async function saveModelContext(
  reference: ModelReference,
  tier: ContextTier,
  revision: number,
): Promise<void> {
  try {
    const bridge = window.desktop?.settings.providers;
    if (!bridge) throw new Error(i18n.t('panel:errors.openDesktopApp'));
    await bridge.setContext(reference, tier, revision);
  } catch (error) {
    showErrorToast(error);
  }
}
