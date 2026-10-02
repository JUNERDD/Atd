import type { ServiceConnection, ServiceModelDefinition } from '@atd/agent-contracts';
import type { ConnectionStore } from '../credentials/connections.js';
import { LedgerNotFound } from '../ledger.js';
import { directoryModels } from './catalog.js';

export function mustConnection(store: ConnectionStore, connectionId: string): ServiceConnection {
  try {
    return store.connection(connectionId);
  } catch {
    throw new LedgerNotFound('Connection', connectionId);
  }
}

/** Keeps the last definition of each model id, so custom models override catalog entries. */
export function uniqueModels(models: readonly ServiceModelDefinition[]): ServiceModelDefinition[] {
  return models.filter(
    (model, index, all) => !all.slice(index + 1).some((item) => item.id === model.id),
  );
}

/**
 * A connection as every response carries it: configuration fields filled for
 * records that predate them, and the catalog models are picked from — the
 * last refresh, else the provider's built-in directory — with custom models
 * merged in. Preference writes validate against this same catalog.
 */
export async function presentConnection(connection: ServiceConnection): Promise<ServiceConnection> {
  const customModels = connection.customModels ?? [];
  const catalog = connection.catalog ?? (await directoryModels(connection.provider));
  return {
    ...connection,
    options: connection.options ?? {},
    customModels,
    catalog: uniqueModels([...catalog, ...customModels]),
    catalogError: connection.catalogError ?? '',
  };
}

/** Reads one connection and presents it; unknown ids answer 404. */
export function presentStored(
  store: ConnectionStore,
  connectionId: string,
): Promise<ServiceConnection> {
  return presentConnection(mustConnection(store, connectionId));
}
