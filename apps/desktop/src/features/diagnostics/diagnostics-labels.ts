import type { TFunction } from 'i18next';
import type {
  DoctorLayer,
  DoctorRemediationAction,
  DoctorStatus,
  LiveProbeKind,
} from '@atd/agent-contracts';

export const LAYER_KEYS = {
  install_and_bundle: 'layers.install_and_bundle',
  permissions_and_keychain: 'layers.permissions_and_keychain',
  service_and_storage: 'layers.service_and_storage',
  shell_and_toolchain: 'layers.shell_and_toolchain',
  network_proxy_and_clock: 'layers.network_proxy_and_clock',
  native_addons_and_index: 'layers.native_addons_and_index',
  on_demand_connectivity: 'layers.on_demand_connectivity',
} as const satisfies Record<DoctorLayer, string>;

export const STATUS_KEYS = {
  pass: 'status.pass',
  warn: 'status.warn',
  fail: 'status.fail',
  skipped: 'status.skipped',
} as const satisfies Record<DoctorStatus, string>;

export const PROBE_KIND_KEYS = {
  selection: {
    title: 'liveProbes.kinds.selection.title',
    description: 'liveProbes.kinds.selection.description',
  },
  hotkey: {
    title: 'liveProbes.kinds.hotkey.title',
    description: 'liveProbes.kinds.hotkey.description',
  },
  capture: {
    title: 'liveProbes.kinds.capture.title',
    description: 'liveProbes.kinds.capture.description',
  },
} as const satisfies Record<LiveProbeKind, { title: string; description: string }>;

const CHECK_TITLE_KEYS = {
  'install.app_placement': 'checks.install_app_placement',
  'install.code_signature': 'checks.install_code_signature',
  'install.arch_and_rosetta': 'checks.install_arch_and_rosetta',
  'install.updater_and_extensions': 'checks.install_updater_and_extensions',
  'perm.accessibility': 'checks.perm_accessibility',
  'perm.screen_recording': 'checks.perm_screen_recording',
  'perm.input_and_post_event': 'checks.perm_input_and_post_event',
  'perm.secure_event_input': 'checks.perm_secure_event_input',
  'perm.keychain_and_launch_key': 'checks.perm_keychain_and_launch_key',
  'service.supervisor_and_pid_origin': 'checks.service_supervisor_and_pid_origin',
  'service.lock_and_recovery': 'checks.service_lock_and_recovery',
  'service.storage_and_disk': 'checks.service_storage_and_disk',
  'service.computer_host_lock': 'checks.service_computer_host_lock',
  'shell.login_path_resolution': 'checks.shell_login_path_resolution',
  'shell.node_runtime': 'checks.shell_node_runtime',
  'shell.ripgrep_binary': 'checks.shell_ripgrep_binary',
  'shell.host_cli_tools': 'checks.shell_host_cli_tools',
  'net.system_proxy_alignment': 'checks.net_system_proxy_alignment',
  'net.child_process_proxy_and_ca': 'checks.net_child_process_proxy_and_ca',
  'net.loopback_ipc': 'checks.net_loopback_ipc',
  'native.file_index_addon': 'checks.native_file_index_addon',
  'native.memory_index_health': 'checks.native_memory_index_health',
  'native.optional_addons': 'checks.native_optional_addons',
  'native.mcp_and_wps_bridges': 'checks.native_mcp_and_wps_bridges',
  'conn.mirror_tls_and_clock_skew': 'checks.conn_mirror_tls_and_clock_skew',
  'conn.provider_endpoints': 'checks.conn_provider_endpoints',
} as const;

const REASON_KEYS = {
  ok: 'reasons.ok',
  not_requested: 'reasons.not_requested',
  skipped_in_debug: 'reasons.skipped_in_debug',
  app_translocated: 'reasons.app_translocated',
  running_from_dmg_readonly: 'reasons.running_from_dmg_readonly',
  running_from_downloads: 'reasons.running_from_downloads',
  outside_applications_dir: 'reasons.outside_applications_dir',
  signature_invalid: 'reasons.signature_invalid',
  adhoc_in_release: 'reasons.adhoc_in_release',
  requirement_drifted: 'reasons.requirement_drifted',
  app_running_under_rosetta: 'reasons.app_running_under_rosetta',
  rosetta_absent_info: 'reasons.rosetta_absent_info',
  updater_start_failed: 'reasons.updater_start_failed',
  custom_feed_url: 'reasons.custom_feed_url',
  finder_sync_disabled: 'reasons.finder_sync_disabled',
  not_granted: 'reasons.not_granted',
  stale_or_duplicate_app_grant: 'reasons.stale_or_duplicate_app_grant',
  granted_pending_relaunch: 'reasons.granted_pending_relaunch',
  post_event_denied: 'reasons.post_event_denied',
  listen_event_denied: 'reasons.listen_event_denied',
  uuremote_tap_install_failed: 'reasons.uuremote_tap_install_failed',
  secure_event_input_active: 'reasons.secure_event_input_active',
  keyring_unavailable: 'reasons.keyring_unavailable',
  launch_approval_key_unreadable: 'reasons.launch_approval_key_unreadable',
  launch_approval_key_malformed: 'reasons.launch_approval_key_malformed',
  provider_credential_unreadable: 'reasons.provider_credential_unreadable',
  service_unavailable_failed: 'reasons.service_unavailable_failed',
  service_stopped_too_often: 'reasons.service_stopped_too_often',
  adopted_foreign_bundle_node: 'reasons.adopted_foreign_bundle_node',
  control_stream_reconnecting: 'reasons.control_stream_reconnecting',
  corrupt_lock_auto_recovered: 'reasons.corrupt_lock_auto_recovered',
  automation_store_corrupt: 'reasons.automation_store_corrupt',
  unclean_previous_shutdown: 'reasons.unclean_previous_shutdown',
  disk_critically_low_lt_200mb: 'reasons.disk_critically_low_lt_200mb',
  disk_low_lt_1gb: 'reasons.disk_low_lt_1gb',
  datadir_permission_denied: 'reasons.datadir_permission_denied',
  ledger_approaching_64mb_cap: 'reasons.ledger_approaching_64mb_cap',
  non_local_home_volume: 'reasons.non_local_home_volume',
  host_lock_held_by_other_pid: 'reasons.host_lock_held_by_other_pid',
  unsettled_session_pending: 'reasons.unsettled_session_pending',
  login_shell_timed_out_5s: 'reasons.login_shell_timed_out_5s',
  login_shell_exited_without_path: 'reasons.login_shell_exited_without_path',
  login_shell_slow_gt_2500ms: 'reasons.login_shell_slow_gt_2500ms',
  unsupported_node_version: 'reasons.unsupported_node_version',
  rg_not_found_on_path: 'reasons.rg_not_found_on_path',
  rg_bad_cpu_arch_ebadarch: 'reasons.rg_bad_cpu_arch_ebadarch',
  rg_exec_timeout: 'reasons.rg_exec_timeout',
  mcp_required_launcher_missing: 'reasons.mcp_required_launcher_missing',
  cli_bad_cpu_arch_ebadarch: 'reasons.cli_bad_cpu_arch_ebadarch',
  optional_cli_not_installed: 'reasons.optional_cli_not_installed',
  pac_or_wpad_fallback_to_direct: 'reasons.pac_or_wpad_fallback_to_direct',
  socks_only_fallback_to_direct: 'reasons.socks_only_fallback_to_direct',
  authenticated_proxy_unsupported: 'reasons.authenticated_proxy_unsupported',
  glob_bypass_rules_skipped: 'reasons.glob_bypass_rules_skipped',
  child_env_missing_system_proxy: 'reasons.child_env_missing_system_proxy',
  system_keychain_ca_not_trusted_by_node: 'reasons.system_keychain_ca_not_trusted_by_node',
  extra_ca_certs_missing_or_unreadable: 'reasons.extra_ca_certs_missing_or_unreadable',
  loopback_rtt_high_gt_200ms: 'reasons.loopback_rtt_high_gt_200ms',
  loopback_unreachable: 'reasons.loopback_unreachable',
  napi_addon_load_failed: 'reasons.napi_addon_load_failed',
  external_home_unsupported: 'reasons.external_home_unsupported',
  fsevents_watch_failed: 'reasons.fsevents_watch_failed',
  index_store_failed: 'reasons.index_store_failed',
  sqlite_in_memory_fallback: 'reasons.sqlite_in_memory_fallback',
  fts5_trigram_unavailable: 'reasons.fts5_trigram_unavailable',
  not_installed_optional: 'reasons.not_installed_optional',
  addons_lock_missing_or_invalid: 'reasons.addons_lock_missing_or_invalid',
  addon_integrity_mismatch: 'reasons.addon_integrity_mismatch',
  addon_broken_install_dropped: 'reasons.addon_broken_install_dropped',
  mcp_connections_degraded: 'reasons.mcp_connections_degraded',
  wps_bridge_error: 'reasons.wps_bridge_error',
  clock_skew_gt_300s: 'reasons.clock_skew_gt_300s',
  clock_skew_gt_120s: 'reasons.clock_skew_gt_120s',
  tls_untrusted_ca_mitm: 'reasons.tls_untrusted_ca_mitm',
  network_unreachable: 'reasons.network_unreachable',
  provider_auth_failed: 'reasons.provider_auth_failed',
  provider_tls_or_proxy_failed: 'reasons.provider_tls_or_proxy_failed',
  local_network_permission_denied: 'reasons.local_network_permission_denied',
  doctor_budget_exceeded: 'reasons.doctor_budget_exceeded',
} as const;

const REMEDIATION_KEYS = {
  move_bundle_to_applications: 'remediation.move_bundle_to_applications',
  relaunch_or_reinstall_signed_app: 'remediation.relaunch_or_reinstall_signed_app',
  install_native_arm64_build: 'remediation.install_native_arm64_build',
  enable_login_items_extensions: 'remediation.enable_login_items_extensions',
  grant_or_reset_accessibility: 'remediation.grant_or_reset_accessibility',
  grant_screen_recording: 'remediation.grant_screen_recording',
  grant_input_monitoring: 'remediation.grant_input_monitoring',
  close_secure_input_holder: 'remediation.close_secure_input_holder',
  reapprove_mcp_or_reconnect_provider: 'remediation.reapprove_mcp_or_reconnect_provider',
  restart_agent_service: 'remediation.restart_agent_service',
  inspect_service_recovery: 'remediation.inspect_service_recovery',
  free_disk_or_fix_permissions: 'remediation.free_disk_or_fix_permissions',
  reconcile_computer_host: 'remediation.reconcile_computer_host',
  optimize_shell_rc_profile: 'remediation.optimize_shell_rc_profile',
  reinstall_official_release: 'remediation.reinstall_official_release',
  install_native_ripgrep: 'remediation.install_native_ripgrep',
  fix_mcp_cli_toolchain: 'remediation.fix_mcp_cli_toolchain',
  configure_supported_http_proxy: 'remediation.configure_supported_http_proxy',
  configure_proxy_and_ca_trust: 'remediation.configure_proxy_and_ca_trust',
  check_loopback_firewall_vpn: 'remediation.check_loopback_firewall_vpn',
  reinstall_or_check_home_volume: 'remediation.reinstall_or_check_home_volume',
  inspect_memory_index_fallback: 'remediation.inspect_memory_index_fallback',
  manage_browser_addon: 'remediation.manage_browser_addon',
  open_mcp_extensions_settings: 'remediation.open_mcp_extensions_settings',
  sync_clock_or_trust_ca: 'remediation.sync_clock_or_trust_ca',
  check_provider_or_local_network: 'remediation.check_provider_or_local_network',
} as const;

const REMEDIATION_ACTION_KEYS = {
  open_system_settings_accessibility: 'remediationActions.open_system_settings_accessibility',
  open_system_settings_screen_recording: 'remediationActions.open_system_settings_screen_recording',
  open_system_settings_input_monitoring: 'remediationActions.open_system_settings_input_monitoring',
  open_system_settings_login_items: 'remediationActions.open_system_settings_login_items',
  move_to_applications: 'remediationActions.move_to_applications',
  restart_service: 'remediationActions.restart_service',
  relaunch_app: 'remediationActions.relaunch_app',
  open_settings_section: 'remediationActions.open_settings_section',
  run_live_probe: 'remediationActions.run_live_probe',
  open_external_docs: 'remediationActions.open_external_docs',
} as const;

export function translateRemediationAction(
  t: TFunction<'diagnostics'>,
  action: DoctorRemediationAction,
): string | null {
  if (action === 'none') return null;
  const key = REMEDIATION_ACTION_KEYS[action];
  return t(key);
}

export function translateCheckTitle(t: TFunction<'diagnostics'>, id: string): string {
  const key = CHECK_TITLE_KEYS[id as keyof typeof CHECK_TITLE_KEYS];
  return key ? t(key) : t('checks.unknownCheck', { id });
}

export function translateReason(t: TFunction<'diagnostics'>, code: string): string {
  const key = REASON_KEYS[code as keyof typeof REASON_KEYS];
  return key ? t(key) : t('reasons.unknownReason', { code });
}

export function translateRemediation(t: TFunction<'diagnostics'>, code: string): string | null {
  const key = REMEDIATION_KEYS[code as keyof typeof REMEDIATION_KEYS];
  return key ? t(key) : null;
}
