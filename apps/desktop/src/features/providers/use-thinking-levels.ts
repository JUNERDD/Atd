import { useEffect, useState } from 'react';
import type { ModelReference, ModelThinkingLevel } from '../../client/providers/schema';
import { useServiceStatus } from '../service/use-service';

/** One request per connection and model; concurrent consumers of the same model share it. */
const pending = new Map<string, Promise<ModelThinkingLevel[]>>();

function levelsKey(connectionId: string, modelId: string): string {
  return `${connectionId}:${modelId}`;
}

/**
 * Pi's selectable levels for one model, requested from the main process. Never rejects to the
 * caller: a missing bridge, an unknown model, or a failed request all resolve to no options.
 */
function loadThinkingLevels(reference: ModelReference): Promise<ModelThinkingLevel[]> {
  const key = levelsKey(reference.connectionId, reference.modelId);
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const bridge = window.desktop?.settings.providers;
  const request = bridge
    ? bridge.levels(reference).catch(() => [] as ModelThinkingLevel[])
    : Promise.resolve([] as ModelThinkingLevel[]);
  pending.set(key, request);
  void request.finally(() => pending.delete(key));
  return request;
}

export interface ThinkingLevels {
  levels: ModelThinkingLevel[];
  loading: boolean;
}

/**
 * Levels for one model selection, resolved once per selection while the service is connected and
 * again after each reconnect, because main answers from the live service. A failed request
 * settles as an empty list so the control stops waiting and stays disabled.
 */
export function useThinkingLevels(reference: ModelReference | null): ThinkingLevels {
  const connectionId = reference?.connectionId ?? null;
  const modelId = reference?.modelId ?? null;
  const connected = useServiceStatus().status?.state === 'connected';
  const key = connected && connectionId && modelId ? levelsKey(connectionId, modelId) : null;
  const [answers, setAnswers] = useState<ReadonlyMap<string, ModelThinkingLevel[]>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!connected || !connectionId || !modelId) return;
    const requested = levelsKey(connectionId, modelId);
    let active = true;
    void loadThinkingLevels({ connectionId, modelId }).then((levels) => {
      if (!active) return;
      setAnswers((current) =>
        current.get(requested) === levels ? current : new Map(current).set(requested, levels),
      );
    });
    return () => {
      active = false;
    };
  }, [connected, connectionId, modelId]);
  const levels = key ? answers.get(key) : undefined;
  return { levels: levels ?? [], loading: Boolean(key) && levels === undefined };
}
