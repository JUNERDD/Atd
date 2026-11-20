import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import type {
  DoctorCheckResult,
  DoctorLayer,
  DoctorMetricValue,
  DoctorRemediation,
  DoctorRemediationAction,
  ServiceConnection,
} from '@atd/agent-contracts';
import {
  hasKeyringModule,
  keyringServiceName,
  probeTestKeyringPassive,
  type KeyringStatus,
} from '../credentials/keyring.js';
import { getCachedStatus, isTestMode } from '../credentials/keyring-cache.js';
import type { ServicePaths } from '../storage.js';
import { scrubPersonalPaths } from './scrub-paths.js';

export const CHILD_VERSION_TIMEOUT_MS = 1_200;
const KEYRING_PROBE_TIMEOUT_MS = 300;
const CONNECTIVITY_TIMEOUT_MS = 1_500;
const DEFAULT_MIRROR_URL = 'https://downloads.atd.best';
const TLS_CERT_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export interface BinaryProbeOutcome {
  ok: boolean;
  version: string | null;
  errorKind: 'missing' | 'ebadarch' | 'timeout' | 'failed' | null;
}

export const docsRem = (remediationCode: string): DoctorRemediation => ({
  remediationCode,
  action: 'open_external_docs',
  docsUrl: 'https://atd.best',
});

export const actRem = (
  remediationCode: string,
  action: DoctorRemediationAction,
  settingsSection?: string,
): DoctorRemediation =>
  settingsSection ? { remediationCode, action, settingsSection } : { remediationCode, action };

export function isNodeUseSystemCaEnabled(): boolean {
  return (
    process.env.NODE_USE_SYSTEM_CA === '1' ||
    process.execArgv.includes('--use-system-ca') ||
    (process.env.NODE_OPTIONS ?? '').includes('--use-system-ca')
  );
}

export function readPathSummary() {
  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return {
    entryCount: Math.min(512, entries.length),
    hasHomebrewPath: entries.includes('/opt/homebrew/bin'),
    hasUsrLocalPath: entries.includes('/usr/local/bin'),
  };
}

export async function timedCheck(
  id: string,
  layer: DoctorLayer,
  run: () => Promise<Omit<DoctorCheckResult, 'id' | 'layer' | 'durationMs'>>,
): Promise<DoctorCheckResult> {
  const started = performance.now();
  const body = await run();
  const durationMs = Math.min(60_000, Math.max(0, Math.round(performance.now() - started)));
  return { id, layer, durationMs, ...body };
}

export function extractNestedErrorCode(error: unknown): string | null {
  let cur: unknown = error;
  for (let i = 0; i < 6 && cur && typeof cur === 'object'; i += 1) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export function isTlsCertCode(code: string | null): boolean {
  return code !== null && TLS_CERT_CODES.has(code);
}

export function runVersionProbe(
  command: string,
  args: readonly string[],
  timeoutMs = CHILD_VERSION_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<BinaryProbeOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (out: BinaryProbeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(out);
    };
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Exited.
      }
      finish({ ok: false, version: null, errorKind: 'timeout' });
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(onAbort, timeoutMs);
    child.stdout?.on('data', (c: Buffer) => {
      if (stdout.length < 512) stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      if (stderr.length < 512) stderr += c.toString('utf8');
    });
    child.once('error', (err: NodeJS.ErrnoException) => {
      const msg = `${err.message} ${stderr}`;
      if (err.code === 'ENOENT') finish({ ok: false, version: null, errorKind: 'missing' });
      else if (err.code === 'EBADARCH' || err.errno === 86 || /bad cpu type|EBADARCH/i.test(msg))
        finish({ ok: false, version: null, errorKind: 'ebadarch' });
      else finish({ ok: false, version: null, errorKind: 'failed' });
    });
    child.once('close', (code) => {
      if (code === 0) {
        const line = scrubPersonalPaths(stdout.split(/\r?\n/, 1)[0]?.trim() ?? '').slice(0, 64);
        finish({ ok: true, version: line || 'unknown', errorKind: null });
      } else {
        finish({
          ok: false,
          version: null,
          errorKind: /bad cpu type|EBADARCH/i.test(stderr) ? 'ebadarch' : 'failed',
        });
      }
    });
  });
}

function probeDarwinKeychainNonModal(timeoutMs: number): Promise<KeyringStatus> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    const finish = (status: KeyringStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const child = spawn('/usr/bin/security', ['show-keychain-info'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Exited.
      }
      finish({ available: false, backend: 'unavailable', detail: 'Timed out.' });
    }, timeoutMs);
    child.stderr?.on('data', (c: Buffer) => {
      if (stderr.length < 256) stderr += c.toString('utf8');
    });
    child.once('error', (err) => {
      finish({
        available: false,
        backend: 'unavailable',
        detail: scrubPersonalPaths(err.message).slice(0, 128),
      });
    });
    child.once('close', (code) => {
      if (code === 0) {
        finish({ available: true, backend: 'keychain', detail: 'Default keychain unlocked.' });
      } else {
        const line = scrubPersonalPaths(stderr.split(/\r?\n/, 1)[0]?.trim() ?? '').slice(0, 128);
        finish({
          available: false,
          backend: 'unavailable',
          detail: line || `Keychain unavailable (exit ${code ?? 'unknown'}).`,
        });
      }
    });
  });
}

export async function probeKeyringPassive(
  serviceId: string,
  override?: () => Promise<KeyringStatus>,
): Promise<KeyringStatus> {
  if (override) return override();
  if (isTestMode()) return probeTestKeyringPassive(serviceId, KEYRING_PROBE_TIMEOUT_MS);
  const cached = getCachedStatus(keyringServiceName(serviceId));
  if (cached) return cached;
  if (!(await hasKeyringModule())) {
    return { available: false, backend: 'unavailable', detail: 'Module missing.' };
  }
  if (process.platform === 'darwin') {
    return probeDarwinKeychainNonModal(KEYRING_PROBE_TIMEOUT_MS);
  }
  if (process.platform === 'win32') {
    return { available: true, backend: 'credential-manager', detail: 'Passive check.' };
  }
  return process.env.DBUS_SESSION_BUS_ADDRESS?.trim()
    ? { available: true, backend: 'secret-service', detail: 'Session bus present.' }
    : { available: false, backend: 'unavailable', detail: 'No Secret Service session bus.' };
}

export async function defaultProviderEndpointProbe(conn: ServiceConnection, signal: AbortSignal) {
  try {
    const res = await fetch(conn.baseUrl, { method: 'HEAD', redirect: 'manual', signal });
    await res.body?.cancel().catch(() => undefined);
    // Unauthenticated HEAD on auth-protected endpoints proves reachability when returning 401/403.
    const ok =
      conn.authType === 'none'
        ? res.status < 500 && res.status !== 401 && res.status !== 403
        : res.status < 500;
    return { ok, status: res.status };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function probeStorageAndDisk(paths: ServicePaths, homeDir: string) {
  const nonLocalHome = homeDir.startsWith('/Volumes/');
  const writable = await access(paths.root, constants.R_OK | constants.W_OK).then(
    () => true,
    () => false,
  );
  const rem = actRem('free_disk_or_fix_permissions', 'none');
  if (!writable) {
    return {
      status: 'fail' as const,
      reasonCode: 'datadir_permission_denied',
      metrics: { writable: false, nonLocalHome },
      remediation: rem,
    };
  }
  const [fsStats, ledgerStat] = await Promise.all([
    statfs(paths.root),
    stat(paths.ledgerFile).catch(() => null),
  ]);
  const freeBytes = Number(fsStats.bavail) * Number(fsStats.bsize);
  const ledgerBytes = ledgerStat?.size ?? 0;
  const metrics: Record<string, DoctorMetricValue> = {
    writable: true,
    freeMiB: Math.round(freeBytes / (1024 * 1024)),
    ledgerBytes,
    nonLocalHome,
  };
  if (freeBytes < 200 * 1024 * 1024)
    return {
      status: 'fail' as const,
      reasonCode: 'disk_critically_low_lt_200mb',
      metrics,
      remediation: rem,
    };
  if (freeBytes < 1024 * 1024 * 1024)
    return { status: 'warn' as const, reasonCode: 'disk_low_lt_1gb', metrics, remediation: rem };
  if (ledgerBytes >= 48 * 1024 * 1024)
    return {
      status: 'warn' as const,
      reasonCode: 'ledger_approaching_64mb_cap',
      metrics,
      remediation: rem,
    };
  if (nonLocalHome)
    return {
      status: 'warn' as const,
      reasonCode: 'non_local_home_volume',
      metrics,
      remediation: rem,
    };
  return { status: 'pass' as const, reasonCode: 'ok', metrics };
}

export async function probeMirrorHead(options: {
  includeConnectivity: boolean;
  mirrorUrl?: string | undefined;
  headMirror?: ((url: string, signal: AbortSignal) => Promise<Response>) | undefined;
  nowMs?: (() => number) | undefined;
  signal?: AbortSignal | undefined;
}) {
  if (!options.includeConnectivity) {
    return {
      status: 'skipped' as const,
      reasonCode: 'not_requested',
      metrics: { requested: false },
    };
  }
  const url = options.mirrorUrl ?? DEFAULT_MIRROR_URL;
  const timeout = AbortSignal.timeout(CONNECTIVITY_TIMEOUT_MS);
  const sig = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const head =
    options.headMirror ??
    ((u: string, s: AbortSignal) => fetch(u, { method: 'HEAD', redirect: 'manual', signal: s }));
  const rem = actRem('sync_clock_or_trust_ca', 'none');
  try {
    const res = await head(url, sig);
    await res.body?.cancel().catch(() => undefined);
    const parsed = res.headers.get('date') ? Date.parse(res.headers.get('date')!) : Number.NaN;
    const skewSec = Number.isFinite(parsed)
      ? Math.round((parsed - (options.nowMs ?? Date.now)()) / 1000)
      : null;
    const absSkew = skewSec === null ? 0 : Math.abs(skewSec);
    const metrics: Record<string, DoctorMetricValue> = {
      httpStatus: res.status,
      ...(skewSec !== null ? { clockSkewSec: skewSec } : {}),
    };
    if (absSkew > 300)
      return {
        status: 'fail' as const,
        reasonCode: 'clock_skew_gt_300s',
        metrics,
        remediation: rem,
      };
    if (absSkew > 120)
      return {
        status: 'warn' as const,
        reasonCode: 'clock_skew_gt_120s',
        metrics,
        remediation: rem,
      };
    return { status: 'pass' as const, reasonCode: 'ok', metrics };
  } catch (error) {
    const code = extractNestedErrorCode(error);
    const metrics: Record<string, DoctorMetricValue> = code ? { errorCode: code } : {};
    return isTlsCertCode(code)
      ? { status: 'fail' as const, reasonCode: 'tls_untrusted_ca_mitm', metrics, remediation: rem }
      : { status: 'warn' as const, reasonCode: 'network_unreachable', metrics, remediation: rem };
  }
}
