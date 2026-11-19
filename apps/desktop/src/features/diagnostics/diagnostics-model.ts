import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import type {
  DoctorCheckResult,
  DoctorLayer,
  DoctorRemediation,
  DoctorRunResponse,
  DoctorStatus,
} from '@atd/agent-contracts';
import type { ShellDoctorCheck, ShellDoctorReport } from '../../client/diagnostics-contract';
import { messageOf } from '../../lib/errors';
import { SettingsSectionActiveContext } from '../settings/settings-navigation';

export const DOCTOR_LAYERS: readonly DoctorLayer[] = [
  'install_and_bundle',
  'permissions_and_keychain',
  'service_and_storage',
  'shell_and_toolchain',
  'network_proxy_and_clock',
  'native_addons_and_index',
  'on_demand_connectivity',
];

export interface UnifiedDoctorCheck {
  id: string;
  layer: DoctorLayer;
  status: DoctorStatus;
  reasonCode: string;
  durationMs: number;
  metrics: ReadonlyArray<{ key: string; value: string }>;
  remediation?: DoctorRemediation;
}

function normalizeServiceCheck(check: DoctorCheckResult): UnifiedDoctorCheck {
  return {
    id: check.id,
    layer: check.layer,
    status: check.status,
    reasonCode: check.reasonCode,
    durationMs: check.durationMs,
    metrics: Object.entries(check.metrics).map(([key, value]) => ({
      key,
      value: String(value),
    })),
    ...(check.remediation ? { remediation: check.remediation } : {}),
  };
}

function normalizeShellCheck(check: ShellDoctorCheck): UnifiedDoctorCheck {
  return {
    id: check.id,
    layer: check.layer,
    status: check.status,
    reasonCode: check.reasonCode,
    durationMs: check.durationMs,
    metrics: check.metrics.map(({ key, value }) => ({ key, value })),
    ...(check.remediation ? { remediation: check.remediation } : {}),
  };
}

const STATUS_SEVERITY: Record<DoctorStatus, number> = {
  fail: 3,
  warn: 2,
  pass: 1,
  skipped: 0,
};

function mergeCheckMetrics(
  existing: ReadonlyArray<{ key: string; value: string }>,
  incoming: ReadonlyArray<{ key: string; value: string }>,
): ReadonlyArray<{ key: string; value: string }> {
  const seen = new Set(existing.map((metric) => metric.key));
  const merged = [...existing];
  for (const metric of incoming) {
    if (!seen.has(metric.key)) {
      seen.add(metric.key);
      merged.push(metric);
    }
  }
  return merged;
}

function reconcileDoctorChecks(
  existing: UnifiedDoctorCheck,
  incoming: UnifiedDoctorCheck,
): UnifiedDoctorCheck {
  const existingRank = STATUS_SEVERITY[existing.status];
  const incomingRank = STATUS_SEVERITY[incoming.status];
  let winner: UnifiedDoctorCheck;
  if (incomingRank > existingRank) {
    winner = incoming;
  } else if (existingRank > incomingRank) {
    winner = existing;
  } else {
    winner = !existing.remediation && incoming.remediation ? incoming : existing;
  }
  return {
    id: existing.id,
    layer: winner.layer,
    status: winner.status,
    reasonCode: winner.reasonCode,
    durationMs: Math.max(existing.durationMs, incoming.durationMs),
    metrics: mergeCheckMetrics(existing.metrics, incoming.metrics),
    ...(winner.remediation ? { remediation: winner.remediation } : {}),
  };
}

/** Merges Swift Shell checks and Node Service checks in canonical layer order. */
export function mergeDoctorChecks(
  shellChecks: readonly ShellDoctorCheck[],
  serviceChecks: readonly DoctorCheckResult[],
): UnifiedDoctorCheck[] {
  const byId = new Map<string, UnifiedDoctorCheck>();
  for (const check of shellChecks) {
    const normalized = normalizeShellCheck(check);
    const existing = byId.get(normalized.id);
    byId.set(normalized.id, existing ? reconcileDoctorChecks(existing, normalized) : normalized);
  }
  for (const check of serviceChecks) {
    const normalized = normalizeServiceCheck(check);
    const existing = byId.get(normalized.id);
    byId.set(normalized.id, existing ? reconcileDoctorChecks(existing, normalized) : normalized);
  }
  return [...byId.values()];
}

export function groupChecksByLayer(
  checks: readonly UnifiedDoctorCheck[],
): ReadonlyArray<{ layer: DoctorLayer; checks: UnifiedDoctorCheck[] }> {
  return DOCTOR_LAYERS.map((layer) => ({
    layer,
    checks: checks.filter((check) => check.layer === layer),
  })).filter((group) => group.checks.length > 0);
}

export function summarizeChecks(checks: readonly UnifiedDoctorCheck[]) {
  const counts = { pass: 0, warn: 0, fail: 0, skipped: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

export function useDiagnosticsDoctor(includeConnectivity: boolean) {
  const sectionActive = useContext(SettingsSectionActiveContext);
  const [running, setRunning] = useState(false);
  const [shellReport, setShellReport] = useState<ShellDoctorReport | null>(null);
  const [serviceReport, setServiceReport] = useState<DoctorRunResponse | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);
  const runSeq = useRef(0);
  const lastRunConnectivity = useRef<boolean | null>(null);

  const runChecks = useCallback(async (withConnectivity: boolean) => {
    const bridge = window.desktop?.diagnostics;
    if (!bridge) return;
    lastRunConnectivity.current = withConnectivity;
    const seq = ++runSeq.current;
    setRunning(true);
    setShellError(null);
    setServiceError(null);

    const [shellResult, serviceResult] = await Promise.allSettled([
      bridge.shellReport(),
      bridge.runDoctor(withConnectivity),
    ]);
    if (runSeq.current !== seq) return;

    if (shellResult.status === 'fulfilled') {
      setShellReport(shellResult.value);
    } else {
      setShellReport(null);
      setShellError(messageOf(shellResult.reason));
    }
    if (serviceResult.status === 'fulfilled') {
      setServiceReport(serviceResult.value);
    } else {
      setServiceReport(null);
      setServiceError(messageOf(serviceResult.reason));
    }
    setRunning(false);
  }, []);

  // A layout effect, so the page's first paint already shows the run in progress (the busy button
  // and the checks placeholder) instead of the idle prompt it replaces a frame later.
  useLayoutEffect(() => {
    if (!sectionActive || lastRunConnectivity.current === includeConnectivity) return;
    lastRunConnectivity.current = includeConnectivity;
    void runChecks(includeConnectivity);
  }, [sectionActive, includeConnectivity, runChecks]);

  const checks = mergeDoctorChecks(shellReport?.checks ?? [], serviceReport?.checks ?? []);
  const layers = groupChecksByLayer(checks);
  const counts = summarizeChecks(checks);

  return {
    running,
    shellReport,
    serviceReport,
    serviceError,
    shellError,
    checks,
    layers,
    counts,
    runChecks: () => runChecks(includeConnectivity),
  };
}
