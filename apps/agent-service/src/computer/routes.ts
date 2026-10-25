import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  COMPUTER_MAX_BINDINGS,
  COMPUTER_MAX_UNRESOLVED_LISTED,
  ComputerResolveFactsRequestSchema,
  Identifier,
  parse,
  SaveComputerBindingRequestSchema,
  type ComputerProgress,
  type ComputerResolveFactsResponse,
  type ComputerUnresolvedFactsResponse,
  type ComputerStatusResponse,
  type DeleteComputerBindingResponse,
  type SaveComputerBindingResponse,
  type StopAllComputerResponse,
} from '@atd/agent-contracts';
import { RENDERER_ROUTE, SHELL_ROUTE } from '../relay-routes.js';
import { resolveByPerson } from './resolve.js';
import type { ComputerRuntime } from './runtime.js';

/** Runs one stop-all answer lists (`StopAllComputerResponse.stoppedRunIds`). */
const MAX_STOPPED_RUNS = 100;

const TaskQuerySchema = Type.Object({ taskId: Identifier }, { additionalProperties: false });

/**
 * `GET /v1/computer/progress?taskId=`: the latest live progress of each of the task's runs (D8),
 * for a renderer that reconnects; the stream pushes later frames as `computer.progress`.
 */
export interface ComputerProgressResponse {
  progress: ComputerProgress[];
}

/**
 * The computer routes (D7). The renderer reads status and progress, deletes bindings, resolves
 * facts a person checked and stops all computer work; only the shell writes a binding's content,
 * from a target its host prepared.
 * A binding whose content changes or that is deleted first invalidates the grants naming it (the
 * store's listeners), then stops the runs acting on it and asks the host to release its targets.
 */
export function registerComputerRoutes(app: FastifyInstance, computer: ComputerRuntime): void {
  const { bindings, coordinator } = computer;

  app.get('/v1/computer', RENDERER_ROUTE, async (): Promise<ComputerStatusResponse> => {
    const busy = new Map<string, { bindingId: string; taskId: string; runId: string }>();
    for (const entry of coordinator.busy()) busy.set(entry.bindingId, entry);
    return {
      host: coordinator.hostStatus(),
      bindings: bindings.list(),
      busy: [...busy.values()].slice(0, COMPUTER_MAX_BINDINGS),
    };
  });

  app.get(
    '/v1/computer/progress',
    RENDERER_ROUTE,
    async (request): Promise<ComputerProgressResponse> => {
      const { taskId } = parse(TaskQuerySchema, request.query);
      return { progress: coordinator.progress.forTask(taskId) };
    },
  );

  app.post(
    '/v1/computer/bindings',
    SHELL_ROUTE,
    async (request): Promise<SaveComputerBindingResponse> => {
      const body = parse(SaveComputerBindingRequestSchema, request.body);
      const before = body.bindingId ? bindings.get(body.bindingId) : undefined;
      const binding = await bindings.save(body);
      if (before && before.revision !== binding.revision)
        await coordinator.revokeBinding(binding.bindingId);
      return { binding };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/computer/bindings/:id',
    RENDERER_ROUTE,
    async (request): Promise<DeleteComputerBindingResponse> => {
      const bindingId = parse(Identifier, request.params.id);
      const invalidatedAutomationIds = await bindings.delete(bindingId);
      await coordinator.revokeBinding(bindingId);
      return { invalidatedAutomationIds: invalidatedAutomationIds.slice(0, 100) };
    },
  );

  app.get(
    '/v1/computer/facts/unresolved',
    RENDERER_ROUTE,
    async (request): Promise<ComputerUnresolvedFactsResponse> => {
      const { taskId } = parse(TaskQuerySchema, request.query);
      const actionIds = computer.records
        .unresolved()
        .filter((fact) => fact.taskId === taskId && fact.effect !== 'read')
        .map((fact) => fact.actionId);
      return { actionIds: actionIds.slice(0, COMPUTER_MAX_UNRESOLVED_LISTED) };
    },
  );

  app.post(
    '/v1/computer/facts/resolve',
    RENDERER_ROUTE,
    async (request): Promise<ComputerResolveFactsResponse> => {
      const { taskId, actionIds } = parse(ComputerResolveFactsRequestSchema, request.body);
      return { resolved: await resolveByPerson(computer.records, taskId, actionIds) };
    },
  );

  app.post('/v1/computer/stop-all', RENDERER_ROUTE, async (): Promise<StopAllComputerResponse> => {
    const stopped = await computer.stopAll('stopped');
    return { stoppedRunIds: stopped.slice(0, MAX_STOPPED_RUNS) };
  });
}
