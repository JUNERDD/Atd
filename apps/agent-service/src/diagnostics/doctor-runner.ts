import {
  DoctorRunResponseSchema,
  parse,
  type DoctorCheckResult,
  type DoctorLayer,
  type DoctorMetricValue,
  type DoctorRunRequest,
  type DoctorRunResponse,
} from '@atd/agent-contracts';
import type { AddonRegistry } from '../addons/registry.js';
import type { AutomationService } from '../automations/service.js';
import type { ServiceConfig } from '../config.js';
import type { Logger } from '../logging.js';
import type { SystemProxy } from '../network/system-proxy.js';
import { runEnvDoctorChecks, type EnvDoctorHooks } from './doctor-env.js';
import { readMcpPassiveSummary, type McpPassiveSummary } from './doctor-projections.js';
import { runProviderDoctorChecks, type ProviderDoctorHooks } from './doctor-providers.js';
import { sanitizeMachineCode } from './run-prep-ring.js';
import { scrubPersonalPaths } from './scrub-paths.js';

export const DOCTOR_WALL_BUDGET_MS = 2_200;
const INTERNAL_DEADLINE_MS = 2_000;
const METRIC_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

export interface DoctorRunnerDeps {
  config: ServiceConfig;
  systemProxy: SystemProxy;
  addons: AddonRegistry;
  automations: AutomationService;
  log: Logger;
}

export interface DoctorRunnerHooks extends EnvDoctorHooks, ProviderDoctorHooks {
  budgetMs?: number | undefined;
}

function sanitizeMetrics(
  raw: Record<string, DoctorMetricValue>,
): Record<string, DoctorMetricValue> {
  const out: Record<string, DoctorMetricValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= 32 || !METRIC_KEY_RE.test(key)) continue;
    if (typeof value === 'string') {
      out[key] = scrubPersonalPaths(value).slice(0, 256);
    } else if (typeof value === 'number') {
      out[key] = Number.isFinite(value) ? value : 0;
    } else {
      out[key] = Boolean(value);
    }
    count += 1;
  }
  return out;
}

function sanitizeCheck(check: DoctorCheckResult): DoctorCheckResult {
  return {
    ...check,
    id: sanitizeMachineCode(check.id) ?? 'unknown_check',
    reasonCode: sanitizeMachineCode(check.reasonCode) ?? 'unknown',
    durationMs: Math.min(60_000, Math.max(0, Math.round(check.durationMs))),
    metrics: sanitizeMetrics(check.metrics),
  };
}

function withBudget<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  if (ms <= 0) return Promise.resolve(fallback());
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback());
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback());
      },
    );
  });
}

function fallbackCheck(id: string, layer: DoctorLayer, elapsedMs: number): DoctorCheckResult {
  return {
    id,
    layer,
    status: 'warn',
    reasonCode: 'doctor_budget_exceeded',
    durationMs: Math.max(0, Math.round(elapsedMs)),
    metrics: { timedOut: true },
  };
}

const EMPTY_MCP_SUMMARY: McpPassiveSummary = {
  launchApprovalKeyState: 'not_created',
  servers: [],
  degradedCount: 0,
  requiredLaunchers: [],
};

/**
 * Runs all Node-side Doctor checks in parallel within a `<= 2,200 ms` wall-clock budget,
 * returning a pre-sanitized `DoctorRunResponse` validated against `@atd/agent-contracts`.
 */
export async function runServiceDoctor(
  deps: DoctorRunnerDeps,
  request: DoctorRunRequest = {},
  hooks: DoctorRunnerHooks = {},
): Promise<DoctorRunResponse> {
  const started = performance.now();
  const budgetMs = Math.min(
    DOCTOR_WALL_BUDGET_MS,
    Math.max(100, hooks.budgetMs ?? INTERNAL_DEADLINE_MS),
  );
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), budgetMs);
  const includeConnectivity = request.includeConnectivity === true;

  try {
    const mcpSummaryPromise = withBudget(
      readMcpPassiveSummary(deps.config.serviceId, deps.config.paths.root, deps.log),
      Math.max(100, budgetMs - 100),
      () => EMPTY_MCP_SUMMARY,
    );

    const envPromises = runEnvDoctorChecks(
      {
        paths: deps.config.paths,
        systemProxy: deps.systemProxy,
        automationsProblem: Boolean(deps.automations.store.problem),
        requiredMcpLaunchers: mcpSummaryPromise.then((m) => m.requiredLaunchers),
        includeConnectivity,
        signal: controller.signal,
      },
      hooks,
    );
    const providerPromises = runProviderDoctorChecks(
      {
        serviceId: deps.config.serviceId,
        paths: deps.config.paths,
        addons: deps.addons,
        log: deps.log,
        includeConnectivity,
        mcpSummary: mcpSummaryPromise,
        signal: controller.signal,
      },
      hooks,
    );

    const allSpecs: Array<{ id: string; layer: DoctorLayer; promise: Promise<DoctorCheckResult> }> =
      [
        { id: 'service.lock_and_recovery', layer: 'service_and_storage', promise: envPromises[0]! },
        { id: 'service.storage_and_disk', layer: 'service_and_storage', promise: envPromises[1]! },
        {
          id: 'shell.login_path_resolution',
          layer: 'shell_and_toolchain',
          promise: envPromises[2]!,
        },
        { id: 'shell.node_runtime', layer: 'shell_and_toolchain', promise: envPromises[3]! },
        { id: 'shell.ripgrep_binary', layer: 'shell_and_toolchain', promise: envPromises[4]! },
        { id: 'shell.host_cli_tools', layer: 'shell_and_toolchain', promise: envPromises[5]! },
        {
          id: 'net.system_proxy_alignment',
          layer: 'network_proxy_and_clock',
          promise: envPromises[6]!,
        },
        {
          id: 'net.child_process_proxy_and_ca',
          layer: 'network_proxy_and_clock',
          promise: envPromises[7]!,
        },
        {
          id: 'native.file_index_addon',
          layer: 'native_addons_and_index',
          promise: envPromises[8]!,
        },
        {
          id: 'conn.mirror_tls_and_clock_skew',
          layer: 'on_demand_connectivity',
          promise: envPromises[9]!,
        },
        {
          id: 'perm.keychain_and_launch_key',
          layer: 'permissions_and_keychain',
          promise: providerPromises[0]!,
        },
        {
          id: 'native.memory_index_health',
          layer: 'native_addons_and_index',
          promise: providerPromises[1]!,
        },
        {
          id: 'native.optional_addons',
          layer: 'native_addons_and_index',
          promise: providerPromises[2]!,
        },
        {
          id: 'native.mcp_and_wps_bridges',
          layer: 'native_addons_and_index',
          promise: providerPromises[3]!,
        },
        {
          id: 'conn.provider_endpoints',
          layer: 'on_demand_connectivity',
          promise: providerPromises[4]!,
        },
      ];

    const checks = await Promise.all(
      allSpecs.map((spec) =>
        withBudget(spec.promise, budgetMs, () =>
          fallbackCheck(spec.id, spec.layer, performance.now() - started),
        ).then(sanitizeCheck),
      ),
    );

    const response: DoctorRunResponse = {
      ranAt: new Date().toISOString(),
      serviceEpoch: deps.config.epoch,
      durationMs: Math.min(120_000, Math.max(0, Math.round(performance.now() - started))),
      includeConnectivity,
      checks,
    };
    return parse(DoctorRunResponseSchema, response);
  } finally {
    clearTimeout(abortTimer);
  }
}
