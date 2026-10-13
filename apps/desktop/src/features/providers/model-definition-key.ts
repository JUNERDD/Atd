import type { Connection } from '../../client/providers/schema';

/**
 * A small fingerprint of what the service derives a model's levels and context windows from: the
 * model's definition in the connection's catalog (its offered windows follow `maxContextWindow`). A background catalog refresh replaces those
 * definitions without bumping the connection revision, so caches of service answers key on this
 * too; an unchanged refresh keeps the same fingerprint and asks nothing again.
 */
export function modelDefinitionKey(connection: Connection | undefined, modelId: string): string {
  const definition = connection?.catalog.find((item) => item.id === modelId);
  if (!definition) return 'unknown';
  return JSON.stringify([
    definition.reasoning,
    definition.thinkingLevelMap ?? null,
    definition.defaultThinkingLevel ?? null,
    definition.contextWindow,
    definition.maxContextWindow ?? null,
    definition.maxTokens,
    definition.cost.tiers ?? null,
  ]);
}
