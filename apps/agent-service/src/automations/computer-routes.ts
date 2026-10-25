import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AutomationComputerApproveRequestSchema,
  ComputerTrialRequestSchema,
  Identifier,
  parse,
  ResolveComputerHoldRequestSchema,
  type AutomationComputerApprovalDetails,
  type AutomationComputerApproveResponse,
  type ComputerTrialResponse,
  type ResolveComputerHoldResponse,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { RENDERER_ROUTE, SHELL_ROUTE } from '../relay-routes.js';
import { approvalDetails, approveComputer, type ApprovalContext } from './computer-approval.js';
import { resolveHold } from './computer-edits.js';
import type { TrialRuns } from './computer-trial-run.js';
import type { AutomationService } from './service.js';

/**
 * The computer routes of automations (decision D7). Granting is shell-only: the details and
 * approve routes sit under `/v1/admin/`, which the relay never forwards, so only the shell's
 * native confirmation can turn a person's approval into a grant. The page may start an attended
 * trial and resolve a hold after a person reviewed the run; neither grants anything.
 */

type WithId = FastifyRequest<{ Params: { id: string } }>;

function unavailable(): ConflictError {
  return new ConflictError('Computer use is not available in this service.');
}

function approvals(service: AutomationService): ApprovalContext {
  const context = service.approvals();
  if (!context) throw unavailable();
  return context;
}

function trials(service: AutomationService): TrialRuns {
  if (!service.trialRuns) throw unavailable();
  return service.trialRuns;
}

export function registerComputerAutomationRoutes(
  app: FastifyInstance,
  service: AutomationService,
): void {
  app.get(
    '/v1/admin/approvals/automation-computer/:id',
    SHELL_ROUTE,
    async (request: WithId): Promise<AutomationComputerApprovalDetails> =>
      approvalDetails(service.store, approvals(service), parse(Identifier, request.params.id)),
  );

  app.post(
    '/v1/admin/approvals/automation-computer',
    SHELL_ROUTE,
    async (request): Promise<AutomationComputerApproveResponse> => {
      const body = parse(AutomationComputerApproveRequestSchema, request.body);
      const now = service.checkContext().now;
      return { grant: await approveComputer(service.store, approvals(service), body, now) };
    },
  );

  app.post(
    '/v1/automations/:id/computer-trial',
    RENDERER_ROUTE,
    async (request: WithId): Promise<ComputerTrialResponse> => {
      const body = parse(ComputerTrialRequestSchema, request.body);
      return trials(service).start(parse(Identifier, request.params.id), body);
    },
  );

  app.post(
    '/v1/automations/:id/computer-hold/resolve',
    RENDERER_ROUTE,
    async (request: WithId): Promise<ResolveComputerHoldResponse> => {
      const body = parse(ResolveComputerHoldRequestSchema, request.body);
      await resolveHold(service.edits(), parse(Identifier, request.params.id), body);
      return { resolved: true };
    },
  );
}
