import { useEffect, useState } from 'react';
import { clampSupportedThinkingLevel } from '@atd/agent-contracts';
import type {
  Connection,
  ModelLevels,
  ModelReference,
  ModelThinkingLevel,
} from '../../client/providers/schema';
import { useServiceStatus } from '../service/use-service';
import { modelDefinitionKey } from './model-definition-key';

/** One request per model definition; concurrent consumers of the same model share it. */
const pending = new Map<string, Promise<ModelLevels>>();

/** Resolved levels cached per provider bridge so remounting dialogs reuse settled answers. */
const resolved = new WeakMap<object, Map<string, ModelLevels>>();

function cacheFor(bridge: object | undefined): Map<string, ModelLevels> | undefined {
  if (!bridge) return undefined;
  let cache = resolved.get(bridge);
  if (!cache) {
    cache = new Map();
    resolved.set(bridge, cache);
  }
  return cache;
}

/** What an unknown model, a missing bridge, or a failed request settles as. */
const NO_LEVELS: ModelLevels = { levels: [], defaultLevel: 'off' };

/**
 * Pi's selectable levels for one model and the level a run uses when none is chosen, requested
 * from the main process. Never rejects to the caller: a missing bridge, an unknown model, or a
 * failed request all resolve to no options.
 */
function loadThinkingLevels(reference: ModelReference, key: string): Promise<ModelLevels> {
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const bridge = window.desktop?.settings.providers;
  const request = bridge
    ? bridge
        .levels(reference)
        .then((answer) => {
          cacheFor(bridge)?.set(key, answer);
          return answer;
        })
        .catch(() => NO_LEVELS)
    : Promise.resolve(NO_LEVELS);
  pending.set(key, request);
  void request.finally(() => pending.delete(key));
  return request;
}

export interface ThinkingLevels extends ModelLevels {
  loading: boolean;
}

/** Clamps a chosen or defaulted thinking level to the levels the model actually supports. */
export function resolveSelectedThinkingLevel(
  thinkingLevel: ModelThinkingLevel | undefined,
  levels: readonly ModelThinkingLevel[],
): ModelThinkingLevel | undefined {
  return thinkingLevel ? clampSupportedThinkingLevel(levels, thinkingLevel) : undefined;
}

/**
 * Levels for one model selection, resolved once per selection while the service is connected,
 * again after each reconnect, because main answers from the live service, and again when a
 * catalog refresh changes the model's definition on `connection`. A failed request settles as an
 * empty list so the control stops waiting and stays disabled. `defaultLevel` is the model's own
 * default, the display fallback for a run with no chosen level; it is never saved, and callers
 * must not show it while `loading`.
 */
export function useThinkingLevels(
  reference: ModelReference | null,
  connection: Connection | undefined,
): ThinkingLevels {
  const connectionId = reference?.connectionId ?? null;
  const modelId = reference?.modelId ?? null;
  const connected = useServiceStatus().status?.state === 'connected';
  const definition = modelId ? modelDefinitionKey(connection, modelId) : null;
  const key =
    connected && connectionId && modelId ? `${connectionId}:${modelId}:${definition}` : null;
  const cached = key ? cacheFor(window.desktop?.settings.providers)?.get(key) : undefined;
  const [answers, setAnswers] = useState<ReadonlyMap<string, ModelLevels>>(() => new Map());
  useEffect(() => {
    if (!key || !connectionId || !modelId || cached !== undefined) return;
    let active = true;
    void loadThinkingLevels({ connectionId, modelId }, key).then((answer) => {
      if (!active) return;
      setAnswers((current) =>
        current.get(key) === answer ? current : new Map(current).set(key, answer),
      );
    });
    return () => {
      active = false;
    };
  }, [key, connectionId, modelId, cached]);
  const answer = (key ? answers.get(key) : undefined) ?? cached;
  return { ...(answer ?? NO_LEVELS), loading: Boolean(key) && answer === undefined };
}
