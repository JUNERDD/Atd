import { useCallback, useContext, useEffect, useRef, useState } from 'react';
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

/** Merges Swift Shell checks and Node Service checks in canonical layer order. */
export function mergeDoctorChecks(
  shellChecks: readonly ShellDoctorCheck[],
  serviceChecks: readonly DoctorCheckResult[],
): UnifiedDoctorCheck[] {
  const byId = new Map<string, UnifiedDoctorCheck>();
  for (const check of shellChecks) byId.set(check.id, normalizeShellCheck(check));
  for (const check of serviceChecks) byId.set(check.id, normalizeServiceCheck(check));
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
  const initialized = useRef(false);

  const runChecks = useCallback(async (withConnectivity: boolean) => {
    const bridge = window.desktop?.diagnostics;
    if (!bridge) return;
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

  useEffect(() => {
    if (!sectionActive || initialized.current) return;
    initialized.current = true;
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
