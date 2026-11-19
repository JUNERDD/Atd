import AICore
import Foundation

nonisolated extension ShellEnvironmentChecks {
  static func makePlacementCheck(
    _ p: ShellEnvironmentProbes.PlacementProbeResult,
    isDev: Bool,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let rec = p.record
    let status: ShellDoctorCheck.Status
    let reason: String
    if rec.isTranslocated {
      status = .fail
      reason = "app_translocated"
    } else if rec.isReadOnlyMount || rec.locationCategory == "volumes_dmg" {
      status = .fail
      reason = "running_from_dmg_readonly"
    } else if rec.locationCategory == "downloads" {
      status = .warn
      reason = "running_from_downloads"
    } else if !isDev && rec.locationCategory == "other" {
      status = .warn
      reason = "outside_applications_dir"
    } else {
      status = .pass
      reason = "ok"
    }
    return ShellDoctorCheck(
      id: "install.app_placement",
      layer: .installAndBundle,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "locationCategory", value: rec.locationCategory),
        .init(key: "translocated", value: String(rec.isTranslocated)),
        .init(key: "readOnlyMount", value: String(rec.isReadOnlyMount)),
        .init(key: "quarantined", value: String(rec.hasQuarantineAttribute)),
      ],
      remediation: status == .pass
        ? nil
        : .init(
          remediationCode: "move_bundle_to_applications",
          action: .moveToApplications,
          settingsSection: nil, probeKind: nil, docsUrl: nil))
  }

  static func makeSignatureCheck(
    _ sig: ShellEnvironmentProbes.SignatureProbeResult,
    isDev: Bool,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let status: ShellDoctorCheck.Status
    let reason: String
    let action: ShellDoctorCheck.Remediation.Action
    let docs: String?
    if !sig.valid {
      status = .fail
      reason = "signature_invalid"
      action = .openExternalDocs
      docs = "https://atd.best"
    } else if !isDev && sig.isAdHoc {
      status = .warn
      reason = "adhoc_in_release"
      action = .openExternalDocs
      docs = "https://atd.best"
    } else if sig.record.requirementMatchesStored == false {
      status = .warn
      reason = "requirement_drifted"
      action = .relaunchApp
      docs = nil
    } else {
      status = .pass
      reason = "ok"
      action = .none
      docs = nil
    }
    return ShellDoctorCheck(
      id: "install.code_signature",
      layer: .installAndBundle,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "valid", value: String(sig.valid)),
        .init(
          key: "designatedReadable", value: String(sig.record.designatedRequirementReadable)),
      ],
      remediation: status == .pass
        ? nil
        : .init(
          remediationCode: "relaunch_or_reinstall_signed_app",
          action: action,
          settingsSection: nil, probeKind: nil, docsUrl: docs))
  }

  static func makeArchCheck(
    _ host: DiagnosticsEnvironmentRecord.HostHardwareRecord,
    arm64Host: Bool,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let status: ShellDoctorCheck.Status
    let reason: String
    if host.isRosettaTranslated {
      status = .warn
      reason = "app_running_under_rosetta"
    } else if arm64Host && !host.rosettaRuntimePresent {
      status = .pass
      reason = "rosetta_absent_info"
    } else {
      status = .pass
      reason = "ok"
    }
    return ShellDoctorCheck(
      id: "install.arch_and_rosetta",
      layer: .installAndBundle,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "arch", value: host.arch),
        .init(key: "rosettaTranslated", value: String(host.isRosettaTranslated)),
        .init(key: "rosettaInstalled", value: String(host.rosettaRuntimePresent)),
      ],
      remediation: status == .warn
        ? .init(
          remediationCode: "install_native_arm64_build",
          action: .openExternalDocs,
          settingsSection: nil, probeKind: nil, docsUrl: "https://atd.best")
        : nil)
  }

  static func makeUpdaterExtensionsCheck(
    snapshot: MainActorSnapshot,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    if snapshot.isDevelopment {
      return ShellDoctorCheck(
        id: "install.updater_and_extensions",
        layer: .installAndBundle,
        status: .skipped,
        reasonCode: "skipped_in_debug",
        durationMs: elapsedMs(since: start),
        metrics: [.init(key: "widgetsAvailable", value: String(snapshot.widgetsAvailable))],
        remediation: nil)
    }
    let loginState = ShellEnvironmentProbes.inspectLoginItemStatus(isDevelopment: false)
    let finder = ShellEnvironmentProbes.inspectFinderSync(
      builtInPlugInsURL: snapshot.builtInPlugInsURL, timeoutMs: 300)

    let status: ShellDoctorCheck.Status
    let reason: String
    if !snapshot.updaterConfigured {
      status = .warn
      reason = "updater_start_failed"
    } else if snapshot.customFeedOverrideSet {
      status = .warn
      reason = "custom_feed_url"
    } else if finder.state == .disabled || loginState == "requires_approval" {
      status = .warn
      reason = "finder_sync_disabled"
    } else {
      status = .pass
      reason = "ok"
    }
    return ShellDoctorCheck(
      id: "install.updater_and_extensions",
      layer: .installAndBundle,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "updaterConfigured", value: String(snapshot.updaterConfigured)),
        .init(key: "widgetsAvailable", value: String(snapshot.widgetsAvailable)),
        .init(key: "loginItemStatus", value: loginState),
        .init(key: "finderSyncState", value: finder.state.rawValue),
      ],
      remediation: status == .warn
        ? .init(
          remediationCode: "enable_login_items_extensions",
          action: .openSystemSettingsLoginItems,
          settingsSection: nil, probeKind: nil, docsUrl: nil)
        : nil)
  }

  static func makeAccessibilityCheck(
    permissions: DiagnosticsEnvironmentRecord.PermissionSnapshotRecord,
    signature: ShellEnvironmentProbes.SignatureProbeResult,
    previouslyHeld: Bool,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let status: ShellDoctorCheck.Status
    let reason: String
    if permissions.accessibilityTrusted {
      status = .pass
      reason = "ok"
    } else if permissions.duplicateAppBundlesCount > 1
      || previouslyHeld
      || signature.record.requirementMatchesStored == false
    {
      status = .fail
      reason = "stale_or_duplicate_app_grant"
    } else {
      status = .warn
      reason = "not_granted"
    }
    return ShellDoctorCheck(
      id: "perm.accessibility",
      layer: .permissionsAndKeychain,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "trusted", value: String(permissions.accessibilityTrusted)),
        .init(key: "duplicateAppBundles", value: String(permissions.duplicateAppBundlesCount)),
      ],
      remediation: status == .pass
        ? nil
        : .init(
          remediationCode: "grant_or_reset_accessibility",
          action: .openSystemSettingsAccessibility,
          settingsSection: nil, probeKind: nil, docsUrl: nil))
  }

  static func makeScreenRecordingCheck(
    permissions: DiagnosticsEnvironmentRecord.PermissionSnapshotRecord,
    previouslyHeld: Bool,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let status: ShellDoctorCheck.Status = permissions.screenRecordingTrusted ? .pass : .warn
    let reason =
      permissions.screenRecordingTrusted
      ? "ok" : (previouslyHeld ? "granted_pending_relaunch" : "not_granted")
    return ShellDoctorCheck(
      id: "perm.screen_recording",
      layer: .permissionsAndKeychain,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [.init(key: "trusted", value: String(permissions.screenRecordingTrusted))],
      remediation: status == .pass
        ? nil
        : .init(
          remediationCode: "grant_screen_recording",
          action: .openSystemSettingsScreenRecording,
          settingsSection: nil, probeKind: nil, docsUrl: nil))
  }

  static func makeInputPostEventCheck(
    permissions: DiagnosticsEnvironmentRecord.PermissionSnapshotRecord,
    uuremoteRunning: Bool,
    uuremoteTapFailed: Bool,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let status: ShellDoctorCheck.Status
    let reason: String
    let remediation: ShellDoctorCheck.Remediation?
    if uuremoteRunning && uuremoteTapFailed {
      status = .warn
      reason = "uuremote_tap_install_failed"
      remediation = .init(
        remediationCode: "grant_or_reset_accessibility",
        action: .openSystemSettingsAccessibility,
        settingsSection: nil, probeKind: nil, docsUrl: nil)
    } else if !permissions.postEventTrusted {
      status = .warn
      reason = "post_event_denied"
      remediation = .init(
        remediationCode: "grant_or_reset_accessibility",
        action: .openSystemSettingsAccessibility,
        settingsSection: nil, probeKind: nil, docsUrl: nil)
    } else if !permissions.listenEventTrusted {
      status = .warn
      reason = "listen_event_denied"
      remediation = .init(
        remediationCode: "grant_input_monitoring",
        action: .openSystemSettingsInputMonitoring,
        settingsSection: nil, probeKind: nil, docsUrl: nil)
    } else {
      status = .pass
      reason = "ok"
      remediation = nil
    }
    return ShellDoctorCheck(
      id: "perm.input_and_post_event",
      layer: .permissionsAndKeychain,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "listenEventTrusted", value: String(permissions.listenEventTrusted)),
        .init(key: "postEventTrusted", value: String(permissions.postEventTrusted)),
      ],
      remediation: remediation)
  }

  static func makeSecureInputCheck(
    permissions: DiagnosticsEnvironmentRecord.PermissionSnapshotRecord,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let active = permissions.secureEventInputEnabled
    return ShellDoctorCheck(
      id: "perm.secure_event_input",
      layer: .permissionsAndKeychain,
      status: active ? .warn : .pass,
      reasonCode: active ? "secure_event_input_active" : "ok",
      durationMs: elapsedMs(since: start),
      metrics: [.init(key: "secureEventInputEnabled", value: String(active))],
      remediation: active
        ? .init(
          remediationCode: "close_secure_input_holder",
          action: .runLiveProbe,
          settingsSection: nil, probeKind: .selection, docsUrl: nil)
        : nil)
  }
}
