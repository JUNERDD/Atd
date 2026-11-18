import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { DoctorCheckResult, DoctorMetricValue } from '@atd/agent-contracts';
import { getConfigRecoveryState } from '../config.js';
import type { SystemProxy } from '../network/system-proxy.js';
import type { ServicePaths } from '../storage.js';
import {
  actRem,
  docsRem,
  isNodeUseSystemCaEnabled,
  probeMirrorHead,
  probeStorageAndDisk,
  timedCheck,
  type BinaryProbeOutcome,
} from './doctor-probes.js';
import { runToolchainAndIndexChecks } from './doctor-toolchain-probes.js';

export interface EnvDoctorInput {
  paths: ServicePaths;
  systemProxy: SystemProxy;
  automationsProblem: boolean;
  requiredMcpLaunchers: Promise<readonly string[]> | readonly string[];
  includeConnectivity: boolean;
  signal?: AbortSignal | undefined;
}

export interface EnvDoctorHooks {
  probeBinary?:
    | ((command: string, args: readonly string[]) => Promise<BinaryProbeOutcome>)
    | undefined;
  resolveRg?: (() => Promise<string>) | undefined;
  mirrorUrl?: string | undefined;
  headMirror?: ((url: string, signal: AbortSignal) => Promise<Response>) | undefined;
  homeDir?: string | undefined;
  nowMs?: (() => number) | undefined;
  probeFileIndex?: (() => Promise<{ ok: boolean; loadErrorCode: string | null }>) | undefined;
}

function checkLockAndDisk(input: EnvDoctorInput, homeDir: string) {
  const lockCheck = timedCheck('service.lock_and_recovery', 'service_and_storage', async () => {
    const r = getConfigRecoveryState();
    const metrics: Record<string, DoctorMetricValue> = {
      corruptLockRecovered: r.corruptLockRecovered,
      staleLockReclaimed: r.staleLockReclaimed,
      serviceFileRecreated: r.serviceFileRecreated,
      tokenRotated: r.tokenRotated,
      automationStoreProblem: input.automationsProblem,
    };
    if (input.automationsProblem) {
      return {
        status: 'fail',
        reasonCode: 'automation_store_corrupt',
        metrics,
        remediation: actRem('inspect_service_recovery', 'restart_service'),
      };
    }
    if (r.corruptLockRecovered || r.serviceFileRecreated || r.tokenRotated) {
      return {
        status: 'warn',
        reasonCode: 'corrupt_lock_auto_recovered',
        metrics,
        remediation: actRem('inspect_service_recovery', 'none'),
      };
    }
    if (r.staleLockReclaimed) {
      return {
        status: 'warn',
        reasonCode: 'unclean_previous_shutdown',
        metrics,
        remediation: actRem('inspect_service_recovery', 'none'),
      };
    }
    return { status: 'pass', reasonCode: 'ok', metrics };
  });

  const diskCheck = timedCheck('service.storage_and_disk', 'service_and_storage', () =>
    probeStorageAndDisk(input.paths, homeDir),
  );
  return [lockCheck, diskCheck];
}

function checkNetworkAndMirror(input: EnvDoctorInput, hooks: EnvDoctorHooks) {
  const proxyAlign = timedCheck(
    'net.system_proxy_alignment',
    'network_proxy_and_clock',
    async () => {
      const s = input.systemProxy.diagnosticsStatus();
      const metrics: Record<string, DoctorMetricValue> = {
        mode: s.mode,
        httpConfigured: s.httpConfigured,
        httpsConfigured: s.httpsConfigured,
        exceptionsCount: s.exceptionsCount,
        skippedBypassCount: s.skippedBypassCount,
      };
      return s.skippedBypassCount > 0
        ? {
            status: 'warn',
            reasonCode: 'glob_bypass_rules_skipped',
            metrics,
            remediation: docsRem('configure_supported_http_proxy', 'proxy'),
          }
        : { status: 'pass', reasonCode: 'ok', metrics };
    },
  );

  const childCa = timedCheck(
    'net.child_process_proxy_and_ca',
    'network_proxy_and_clock',
    async () => {
      const proxy = input.systemProxy.diagnosticsStatus();
      const childProxyEnvSet = Boolean(
        process.env.HTTP_PROXY?.trim() ||
        process.env.HTTPS_PROXY?.trim() ||
        process.env.http_proxy?.trim() ||
        process.env.https_proxy?.trim(),
      );
      const extraCa = process.env.NODE_EXTRA_CA_CERTS?.trim() ?? '';
      const extraCaCertsReadable = extraCa
        ? await access(extraCa, constants.R_OK).then(
            () => true,
            () => false,
          )
        : true;
      const metrics: Record<string, DoctorMetricValue> = {
        proxyMode: proxy.mode,
        childProxyEnvSet,
        hasNodeExtraCaCerts: Boolean(extraCa),
        extraCaCertsReadable,
        nodeUseSystemCa: isNodeUseSystemCaEnabled(),
      };
      const rem = docsRem('configure_proxy_and_ca_trust', 'proxy');
      if (extraCa && !extraCaCertsReadable) {
        return {
          status: 'fail',
          reasonCode: 'extra_ca_certs_missing_or_unreadable',
          metrics,
          remediation: rem,
        };
      }
      if (proxy.mode === 'http' && !childProxyEnvSet) {
        return {
          status: 'warn',
          reasonCode: 'child_env_missing_system_proxy',
          metrics,
          remediation: rem,
        };
      }
      return { status: 'pass', reasonCode: 'ok', metrics };
    },
  );

  const mirror = timedCheck('conn.mirror_tls_and_clock_skew', 'on_demand_connectivity', () =>
    probeMirrorHead({
      includeConnectivity: input.includeConnectivity,
      mirrorUrl: hooks.mirrorUrl,
      headMirror: hooks.headMirror,
      nowMs: hooks.nowMs,
      signal: input.signal,
    }),
  );

  return [proxyAlign, childCa, mirror];
}

/**
 * Builds promises for all environment, storage, toolchain, proxy/TLS, file-index, and
 * opt-in mirror connectivity checks. Preserves the exact result order expected by `doctor-runner`.
 */
export function runEnvDoctorChecks(
  input: EnvDoctorInput,
  hooks: EnvDoctorHooks = {},
): Array<Promise<DoctorCheckResult>> {
  const [lock, disk] = checkLockAndDisk(input, hooks.homeDir ?? homedir());
  const [login, node, rg, cli, fileIndex] = runToolchainAndIndexChecks(
    input.paths.root,
    input.requiredMcpLaunchers,
    input.signal,
    hooks,
  );
  const [proxyAlign, childCa, mirror] = checkNetworkAndMirror(input, hooks);
  return [lock!, disk!, login!, node!, rg!, cli!, proxyAlign!, childCa!, fileIndex!, mirror!];
}
