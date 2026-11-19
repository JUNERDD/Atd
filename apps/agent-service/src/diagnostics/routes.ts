import type { FastifyInstance } from 'fastify';
import {
  DoctorRunRequestSchema,
  parse,
  type DoctorRunResponse,
  type ServiceDiagnosticsSnapshot,
} from '@atd/agent-contracts';
import { RENDERER_ROUTE, SHELL_ROUTE } from '../relay-routes.js';
import type { ServerDeps } from '../server.js';
import { runServiceDoctor, type DoctorRunnerHooks } from './doctor-runner.js';
import { buildServiceDiagnosticsSnapshot } from './snapshot-builder.js';

export interface DiagnosticsRouteOptions {
  hooks?: DoctorRunnerHooks | undefined;
}

/**
 * Registers the dual-plane diagnostics HTTP endpoints:
 * - `POST /v1/diagnostics/run` (`RENDERER_ROUTE`): pre-sanitized Node Doctor checks.
 * - `GET /v1/admin/diagnostics/snapshot` (`SHELL_ROUTE`): allowlisted service snapshot for Swift shell only.
 */
export function registerDiagnosticsRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  options: DiagnosticsRouteOptions = {},
): void {
  app.post('/v1/diagnostics/run', RENDERER_ROUTE, async (request): Promise<DoctorRunResponse> => {
    const body = parse(DoctorRunRequestSchema, request.body ?? {});
    return runServiceDoctor(
      {
        config: deps.config,
        systemProxy: deps.systemProxy,
        addons: deps.addons,
        automations: deps.automations,
        log: deps.log,
      },
      body,
      options.hooks,
    );
  });

  app.get(
    '/v1/admin/diagnostics/snapshot',
    SHELL_ROUTE,
    async (): Promise<ServiceDiagnosticsSnapshot> =>
      buildServiceDiagnosticsSnapshot({
        config: deps.config,
        systemProxy: deps.systemProxy,
        ledger: deps.ledger,
        confirms: deps.confirms,
        capabilities: deps.capabilities,
        computer: deps.computer,
        addons: deps.addons,
        manager: deps.manager,
        automations: deps.automations,
        log: deps.log,
        startedAt: deps.startedAt,
      }),
  );
}
