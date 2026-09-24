import {
  parse,
  PutShellAllowlistRequestSchema,
  PutShellAllowlistResponseSchema,
  type PutShellAllowlistResponse,
} from '@ai/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * Replaces the user shell allowlist the service holds. The desktop main process pushes the full
 * list on every service connection and after every change; the service keeps it in memory only.
 */
export function putShellAllowlist(
  options: AgentClientOptions,
  entries: string[],
  fetchImpl?: typeof fetch,
): Promise<PutShellAllowlistResponse> {
  return manageRequest(
    options,
    '/v1/settings/shell-allowlist',
    'PUT',
    parse(PutShellAllowlistRequestSchema, { entries }),
    (json) => parse(PutShellAllowlistResponseSchema, json),
    fetchImpl,
  );
}
