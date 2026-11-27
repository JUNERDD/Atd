import AICore
import Foundation

nonisolated extension ShellEnvironmentChecks {
  /// Passive check for the Atd for Chrome native messaging channel (`native_addons_and_index`).
  /// Reports counts and booleans only (zero PII, zero disk/network probes).
  static func makeChromeExtensionChannelCheck(
    snapshot: MainActorSnapshot,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let status: ShellDoctorCheck.Status
    let reason: String
    let remediation: ShellDoctorCheck.Remediation?

    if snapshot.chromeHostManifest == .chromeMissing
      || (snapshot.chromeHostManifest == .installed && snapshot.chromePairedCount == 0)
    {
      status = .pass
      reason = "ok"
      remediation = nil
    } else if snapshot.chromeHostManifest == .failed
      && (snapshot.chromePairedCount > 0 || snapshot.chromeInstalledBrowserCount > 0)
    {
      status = .warn
      reason = "chrome_host_manifest_failed"
      remediation = .init(
        remediationCode: "repair_chrome_extension_channel",
        action: .openSettingsSection,
        settingsSection: "computer",
        probeKind: nil,
        docsUrl: nil)
    } else if snapshot.chromePairedCount > 0
      && !snapshot.chromeListenerActive
      && !snapshot.hostLockHeldByOther
    {
      status = .warn
      reason = "chrome_host_socket_inactive"
      remediation = .init(
        remediationCode: "repair_chrome_extension_channel",
        action: .openSettingsSection,
        settingsSection: "computer",
        probeKind: nil,
        docsUrl: nil)
    } else {
      status = .pass
      reason = "ok"
      remediation = nil
    }

    return ShellDoctorCheck(
      id: "native.chrome_extension_channel",
      layer: .nativeAddonsAndIndex,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "pairedProfiles", value: String(snapshot.chromePairedCount)),
        .init(key: "connectedSessions", value: String(snapshot.chromeConnectedCount)),
        .init(key: "installedBrowsers", value: String(snapshot.chromeInstalledBrowserCount)),
        .init(key: "listenerActive", value: String(snapshot.chromeListenerActive)),
      ],
      remediation: remediation)
  }
}
