import AICore
import AIRelay
import Foundation

nonisolated extension ShellEnvironmentChecks {
  static func makeSupervisorCheck(
    snapshot: MainActorSnapshot,
    nodeInsideBundle: Bool?,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let status: ShellDoctorCheck.Status
    let reason: String
    if !snapshot.isDevelopment && nodeInsideBundle == false {
      status = .fail
      reason = "adopted_foreign_bundle_node"
    } else if snapshot.serviceFailureCode == .serviceStoppedTooOften {
      status = .fail
      reason = "service_stopped_too_often"
    } else if snapshot.serviceState == .unavailable {
      status = .fail
      reason = "service_unavailable_failed"
    } else if snapshot.controlReconnecting {
      status = .warn
      reason = "control_stream_reconnecting"
    } else {
      status = .pass
      reason = "ok"
    }
    return ShellDoctorCheck(
      id: "service.supervisor_and_pid_origin",
      layer: .serviceAndStorage,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "serviceState", value: snapshot.serviceState.rawValue),
        .init(
          key: "nodeInsideAppBundle",
          value: nodeInsideBundle.map(String.init) ?? "not_applicable"),
      ],
      remediation: status == .pass
        ? nil
        : .init(
          remediationCode: "restart_agent_service",
          action: .restartService,
          settingsSection: nil, probeKind: nil, docsUrl: nil))
  }

  static func makeHostLockCheck(
    snapshot: MainActorSnapshot,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let status: ShellDoctorCheck.Status
    let reason: String
    let action: ShellDoctorCheck.Remediation.Action
    if snapshot.hostLockHeldByOther {
      status = .warn
      reason = "host_lock_held_by_other_pid"
      action = .relaunchApp
    } else if snapshot.unsettledSessionPending {
      status = .warn
      reason = "unsettled_session_pending"
      action = .none
    } else {
      status = .pass
      reason = "ok"
      action = .none
    }
    return ShellDoctorCheck(
      id: "service.computer_host_lock",
      layer: .serviceAndStorage,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "heldByOtherPid", value: String(snapshot.hostLockHeldByOther)),
        .init(key: "unsettledPending", value: String(snapshot.unsettledSessionPending)),
      ],
      remediation: status == .pass
        ? nil
        : .init(
          remediationCode: "reconcile_computer_host",
          action: action,
          settingsSection: nil, probeKind: nil, docsUrl: nil))
  }

  static func makeProxyCheck(
    proxyFlags: DiagnosticsEnvironmentRecord.SystemProxyFlagsRecord,
    customCaCount: Int,
    since start: ContinuousClock.Instant
  ) -> ShellDoctorCheck {
    let hasHttp = proxyFlags.httpProxyEnabled || proxyFlags.httpsProxyEnabled
    let status: ShellDoctorCheck.Status
    let reason: String
    if (proxyFlags.pacEnabled || proxyFlags.wpadEnabled) && !hasHttp {
      status = .warn
      reason = "pac_or_wpad_fallback_to_direct"
    } else if proxyFlags.socksProxyEnabled && !hasHttp {
      status = .warn
      reason = "socks_only_fallback_to_direct"
    } else {
      status = .pass
      reason = "ok"
    }
    return ShellDoctorCheck(
      id: "net.system_proxy_alignment",
      layer: .networkProxyAndClock,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "pacEnabled", value: String(proxyFlags.pacEnabled)),
        .init(key: "wpadEnabled", value: String(proxyFlags.wpadEnabled)),
        .init(key: "httpProxyEnabled", value: String(proxyFlags.httpProxyEnabled)),
        .init(key: "httpsProxyEnabled", value: String(proxyFlags.httpsProxyEnabled)),
        .init(key: "socksProxyEnabled", value: String(proxyFlags.socksProxyEnabled)),
        .init(key: "customAdminRootCertCount", value: String(customCaCount)),
      ],
      remediation: status == .pass
        ? nil
        : .init(
          remediationCode: "configure_supported_http_proxy",
          action: .openExternalDocs,
          settingsSection: nil, probeKind: nil, docsUrl: "https://atd.best"))
  }

  static func evaluateLoopbackCheck(
    endpoint: ServiceEndpoint?,
    since start: ContinuousClock.Instant
  ) async -> ShellDoctorCheck {
    guard let endpoint else {
      return ShellDoctorCheck(
        id: "net.loopback_ipc",
        layer: .networkProxyAndClock,
        status: .skipped,
        reasonCode: "ok",
        durationMs: elapsedMs(since: start),
        metrics: [.init(key: "reachable", value: "false")],
        remediation: nil)
    }
    let rttStart = ContinuousClock.now
    let reachable = await Deadline.value(within: .milliseconds(350), fallback: false) {
      (try? await ShellClient(endpoint: endpoint).status()) != nil
    }
    let rttMs = elapsedMs(since: rttStart)
    let status: ShellDoctorCheck.Status =
      !reachable ? .fail : (rttMs > 200 ? .warn : .pass)
    let reason =
      !reachable ? "loopback_unreachable" : (rttMs > 200 ? "loopback_rtt_high_gt_200ms" : "ok")
    return ShellDoctorCheck(
      id: "net.loopback_ipc",
      layer: .networkProxyAndClock,
      status: status,
      reasonCode: reason,
      durationMs: elapsedMs(since: start),
      metrics: [
        .init(key: "reachable", value: String(reachable)),
        .init(key: "rttMs", value: String(format: "%.1f", rttMs)),
      ],
      remediation: status == .pass
        ? nil
        : .init(
          remediationCode: "check_loopback_firewall_vpn",
          action: !reachable ? .restartService : .none,
          settingsSection: nil, probeKind: nil, docsUrl: nil))
  }

  static func elapsedMs(since start: ContinuousClock.Instant) -> Double {
    let d = start.duration(to: ContinuousClock.now)
    let ms =
      Double(d.components.seconds) * 1_000.0
      + Double(d.components.attoseconds) / 1_000_000_000_000_000.0
    return min(60_000, max(0, (ms * 100).rounded() / 100))
  }
}
