import { DevelopmentSyncResponseSchema, parse } from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/** One-way configuration import exposed only by an explicitly started development service. */
export function syncDevelopmentData(options: AgentClientOptions) {
  return manageRequest(options, '/v1/development/sync', 'POST', {}, (json) =>
    parse(DevelopmentSyncResponseSchema, json),
  );
}
