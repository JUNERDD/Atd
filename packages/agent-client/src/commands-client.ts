import {
  CommandCreateSchema,
  CommandDeleteResponseSchema,
  CommandGetResponseSchema,
  CommandUpdateRequestSchema,
  CommandsListResponseSchema,
  parse,
  type CommandCreate,
  type CommandDeleteResponse,
  type CommandGetResponse,
  type CommandsListResponse,
  type CommandUpdateRequest,
} from '@ai/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/** Lists service commands, alphabetically by name. */
export function listCommands(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<CommandsListResponse> {
  return manageRequest(
    options,
    '/v1/commands',
    'GET',
    undefined,
    (json) => parse(CommandsListResponseSchema, json),
    fetchImpl,
  );
}

/** Reads one service command. */
export function getCommand(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<CommandGetResponse> {
  return manageRequest(
    options,
    `/v1/commands/${encodeURIComponent(id)}`,
    'GET',
    undefined,
    (json) => parse(CommandGetResponseSchema, json),
    fetchImpl,
  );
}

/** Creates a command; the service assigns revision 1 (and the id by default). */
export function createCommand(
  options: AgentClientOptions,
  body: CommandCreate,
  fetchImpl?: typeof fetch,
): Promise<CommandGetResponse> {
  return manageRequest(
    options,
    '/v1/commands',
    'POST',
    parse(CommandCreateSchema, body),
    (json) => parse(CommandGetResponseSchema, json),
    fetchImpl,
  );
}

/** Full-replace command update guarded by the expected live revision. */
export function updateCommand(
  options: AgentClientOptions,
  id: string,
  body: CommandUpdateRequest,
  fetchImpl?: typeof fetch,
): Promise<CommandGetResponse> {
  return manageRequest(
    options,
    `/v1/commands/${encodeURIComponent(id)}`,
    'PUT',
    parse(CommandUpdateRequestSchema, body),
    (json) => parse(CommandGetResponseSchema, json),
    fetchImpl,
  );
}

/** Deletes a command; revision-guarded. */
export function deleteCommand(
  options: AgentClientOptions,
  id: string,
  revision: number,
  fetchImpl?: typeof fetch,
): Promise<CommandDeleteResponse> {
  return manageRequest(
    options,
    `/v1/commands/${encodeURIComponent(id)}?revision=${revision}`,
    'DELETE',
    undefined,
    (json) => parse(CommandDeleteResponseSchema, json),
    fetchImpl,
  );
}
