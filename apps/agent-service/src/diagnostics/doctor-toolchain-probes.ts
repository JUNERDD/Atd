import type { DoctorCheckResult, DoctorMetricValue } from '@atd/agent-contracts';
import { getFileIndexDiagnostics } from '../file-routes.js';
import { probeNativeIndexAddon } from '../file-search/native-index.js';
import { resolveRipgrep } from '../harness/search/ripgrep.js';
import { getLoginShellPathDiagnostics } from '../login-shell-path.js';
import { assertSupportedNode } from '../node-runtime.js';
import {
  actRem,
  CHILD_VERSION_TIMEOUT_MS,
  docsRem,
  readPathSummary,
  runVersionProbe,
  timedCheck,
  type BinaryProbeOutcome,
} from './doctor-probes.js';

export interface ToolchainHooks {
  probeBinary?:
    | ((command: string, args: readonly string[]) => Promise<BinaryProbeOutcome>)
    | undefined;
  resolveRg?: (() => Promise<string>) | undefined;
  probeFileIndex?: (() => Promise<{ ok: boolean; loadErrorCode: string | null }>) | undefined;
}

export function runToolchainAndIndexChecks(
  dataDir: string,
  requiredMcpLaunchers: Promise<readonly string[]> | readonly string[],
  signal: AbortSignal | undefined,
  hooks: ToolchainHooks,
): Array<Promise<DoctorCheckResult>> {
  const probe =
    hooks.probeBinary ??
    ((c: string, a: readonly string[]) => runVersionProbe(c, a, CHILD_VERSION_TIMEOUT_MS, signal));

  const loginCheck = timedCheck('shell.login_path_resolution', 'shell_and_toolchain', async () => {
    const d = getLoginShellPathDiagnostics();
    const s = readPathSummary();
    const metrics: Record<string, DoctorMetricValue> = {
      invoked: d.invoked,
      resolved: d.resolved,
      durationMs: d.durationMs ?? 0,
      entryCount: s.entryCount,
      hasHomebrewPath: s.hasHomebrewPath,
      hasUsrLocalPath: s.hasUsrLocalPath,
    };
    const rem = docsRem('optimize_shell_rc_profile', 'login-shell');
    if (d.fallbackReason)
      return { status: 'warn', reasonCode: d.fallbackReason, metrics, remediation: rem };
    if (d.resolved && (d.durationMs ?? 0) > 2500) {
      return {
        status: 'warn',
        reasonCode: 'login_shell_slow_gt_2500ms',
        metrics,
        remediation: rem,
      };
    }
    return { status: 'pass', reasonCode: 'ok', metrics };
  });

  const nodeCheck = timedCheck('shell.node_runtime', 'shell_and_toolchain', async () => {
    let supported = true;
    try {
      assertSupportedNode();
    } catch {
      supported = false;
    }
    const metrics: Record<string, DoctorMetricValue> = {
      version: process.version,
      arch: process.arch,
      compileCacheEnabled: process.env.NODE_DISABLE_COMPILE_CACHE !== '1',
    };
    return supported
      ? { status: 'pass', reasonCode: 'ok', metrics }
      : {
          status: 'fail',
          reasonCode: 'unsupported_node_version',
          metrics,
          remediation: docsRem('reinstall_official_release', 'node-runtime'),
        };
  });

  const rgCheck = timedCheck('shell.ripgrep_binary', 'shell_and_toolchain', async () => {
    const rgBin = await (hooks.resolveRg ?? resolveRipgrep)().catch(() => null);
    const rem = docsRem('install_native_ripgrep', 'toolchain');
    if (!rgBin) {
      return {
        status: 'warn',
        reasonCode: 'rg_not_found_on_path',
        metrics: { found: false },
        remediation: rem,
      };
    }
    const out = await probe(rgBin, ['--no-config', '--version']);
    const metrics: Record<string, DoctorMetricValue> = {
      found: out.ok,
      ...(out.version ? { version: out.version } : {}),
    };
    if (out.errorKind === 'ebadarch') {
      return { status: 'fail', reasonCode: 'rg_bad_cpu_arch_ebadarch', metrics, remediation: rem };
    }
    if (out.errorKind === 'timeout') {
      return { status: 'warn', reasonCode: 'rg_exec_timeout', metrics, remediation: rem };
    }
    return out.ok
      ? { status: 'pass', reasonCode: 'ok', metrics }
      : { status: 'warn', reasonCode: 'rg_not_found_on_path', metrics, remediation: rem };
  });

  const cliCheck = timedCheck('shell.host_cli_tools', 'shell_and_toolchain', async () => {
    const [launchers, git, uv, npx] = await Promise.all([
      Promise.resolve(requiredMcpLaunchers),
      probe('git', ['--version']),
      probe('uv', ['--version']),
      probe('npx', ['--version']),
    ]);
    const map: Record<string, BinaryProbeOutcome> = { git, uv, uvx: uv, npx };
    const missingRequired = launchers.some((tool) => map[tool] && !map[tool].ok);
    const anyEbadarch = [git, uv, npx].some((r) => r.errorKind === 'ebadarch');
    const metrics: Record<string, DoctorMetricValue> = {
      gitOk: git.ok,
      uvOk: uv.ok,
      npxOk: npx.ok,
      requiredLauncherCount: launchers.length,
    };
    const rem = actRem('fix_mcp_cli_toolchain', 'open_settings_section', 'extensions');
    if (missingRequired) {
      return {
        status: 'fail',
        reasonCode: 'mcp_required_launcher_missing',
        metrics,
        remediation: rem,
      };
    }
    if (anyEbadarch) {
      return { status: 'warn', reasonCode: 'cli_bad_cpu_arch_ebadarch', metrics, remediation: rem };
    }
    if ([git, uv, npx].some((r) => !r.ok)) {
      return { status: 'pass', reasonCode: 'optional_cli_not_installed', metrics };
    }
    return { status: 'pass', reasonCode: 'ok', metrics };
  });

  const fileIndex = timedCheck('native.file_index_addon', 'native_addons_and_index', async () => {
    const diag = getFileIndexDiagnostics(dataDir);
    let { state, loadErrorCode } = diag;
    if (state === 'cold' && process.platform === 'darwin') {
      const result = hooks.probeFileIndex
        ? await hooks.probeFileIndex()
        : await probeNativeIndexAddon();
      if (!result.ok) {
        state = 'unsupported';
        loadErrorCode = result.loadErrorCode ?? 'addon_load_failed';
      }
    }
    const metrics: Record<string, DoctorMetricValue> = {
      state,
      ...(loadErrorCode ? { loadErrorCode } : {}),
    };
    const rem = docsRem('reinstall_or_check_home_volume', 'file-index');
    if (state === 'unsupported' && loadErrorCode) {
      return { status: 'fail', reasonCode: 'napi_addon_load_failed', metrics, remediation: rem };
    }
    if (loadErrorCode === 'options') {
      return { status: 'warn', reasonCode: 'external_home_unsupported', metrics, remediation: rem };
    }
    if (loadErrorCode === 'events') {
      return { status: 'warn', reasonCode: 'fsevents_watch_failed', metrics, remediation: rem };
    }
    if (state === 'degraded' || loadErrorCode === 'store') {
      return { status: 'warn', reasonCode: 'index_store_failed', metrics, remediation: rem };
    }
    return { status: 'pass', reasonCode: 'ok', metrics };
  });

  return [loginCheck, nodeCheck, rgCheck, cliCheck, fileIndex];
}
