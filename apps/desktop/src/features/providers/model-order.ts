import type { ModelDefinition } from '../../client/providers/schema';

/**
 * Provider catalogs ship sorted by model ID, but refresh overlays and local
 * discovery append new entries. Sort before display so additions keep their
 * sorted position instead of landing at the end of the list.
 */
export function sortModels(models: readonly ModelDefinition[]): ModelDefinition[] {
  return [...models].sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
