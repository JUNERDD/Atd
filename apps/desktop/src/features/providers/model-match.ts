import { rankByQuery, type FieldsMatch } from '@ai/ui/lib/fuzzy-match';

/** Where a query matched one model row. */
export type ModelMatch = FieldsMatch<'name' | 'id' | 'connection'>;

/**
 * One connection's models ranked for a query by what their rows show: the model name, its id, and
 * the connection name heading the group (`undefined` where no heading is shown). The `/model`
 * drill and the model pickers share it so a query ranks models the same way everywhere; the
 * connection id takes no part because no row shows it.
 */
export function rankModels<M extends { name: string; id: string }>(
  models: readonly M[],
  query: string,
  connectionName: string | undefined,
): { item: M; match: ModelMatch | null }[] {
  return rankByQuery(models, query, (model) => ({
    name: model.name,
    id: model.id,
    connection: connectionName,
  }));
}
