import AICore
import AIRelay
import AppKit
import Foundation

/// Swift Shell plane of the 7-layer Doctor (`diagnostics.shellReport` & `environment.json`,
/// `02-doctor-and-live-probes.md` §1–§2).
///
/// Explicitly marked `nonisolated` with `@concurrent` evaluation (`<= 1,500 ms` total wall budget)
/// so `AIShell`'s default `@MainActor` isolation never blocks `CFRunLoopGetMain()` or
/// `RemoteModifierRepair`'s `.cghidEventTap`.
nonisolated enum ShellEnvironmentChecks {
  struct MainActorSnapshot: Sendable {
    let bundleIdentifier: String
    let bundleURL: URL
    let builtInPlugInsURL: URL?
    let homePath: String
    let dataDirectory: URL
    let appVersion: String
    let buildNumber: String
    let isDevelopment: Bool
    let updaterConfigured: Bool
    let customFeedOverrideSet: Bool
    let widgetsAvailable: Bool
    let accessibilityTrusted: Bool
    let accessibilityPreviouslyHeld: Bool
    let screenRecordingTrusted: Bool
    let screenRecordingPreviouslyHeld: Bool
    let storedRequirement: String?
    let uuremoteRunning: Bool
    let uuremoteTapFailed: Bool
    let selectionToolbar: DiagnosticsEnvironmentRecord.SelectionToolbarSnapshotRecord
    let displays: [DiagnosticsEnvironmentRecord.DisplayGeometryRecord]
    let serviceState: DiagnosticsShellReportResult.ServiceState
    let serviceFailureCode: DiagnosticsShellReportResult.ServiceFailureCode?
    let serviceFailureSummary: String?
    let runningServiceEndpoint: ServiceEndpoint?
    let allowedExecutableRoot: URL?
    let controlReconnecting: Bool
    let hostLockHeldByOther: Bool
    let unsettledSessionPending: Bool
    let heldArbiterClaims: [String]
  }

  struct Evaluation: Sendable {
    let capturedAt: String
    let environmentRecord: DiagnosticsEnvironmentRecord
    let checks: [ShellDoctorCheck]
    let rings: [DecisionRingSummary]
  }

  @concurrent
  static func evaluate(
    snapshot: MainActorSnapshot,
    decisionRings: ShellDecisionRings,
    now: Date = Date()
  ) async -> Evaluation {
    let capturedAt = DiagnosticsTimestamp.iso8601UTC(now)

    var checks: [ShellDoctorCheck] = []
    checks.reserveCapacity(12)

    // Layer 1: install_and_bundle
    let tPlacement = ContinuousClock.now
    let placement = ShellEnvironmentProbes.inspectPlacement(
      bundleURL: snapshot.bundleURL,
      homePath: snapshot.homePath,
      widgetsIndexedLocation: snapshot.widgetsAvailable,
      runningNodePid: snapshot.runningServiceEndpoint?.pid,
      allowedExecutableRoot: snapshot.allowedExecutableRoot)
    checks.append(makePlacementCheck(placement, isDev: snapshot.isDevelopment, since: tPlacement))

    let tSig = ContinuousClock.now
    let signature = ShellEnvironmentProbes.inspectSignature(
      storedRequirement: snapshot.storedRequirement)
    checks.append(makeSignatureCheck(signature, isDev: snapshot.isDevelopment, since: tSig))

    let tArch = ContinuousClock.now
    let hardware = ShellEnvironmentProbes.inspectHardware(dataDirectory: snapshot.dataDirectory)
    checks.append(
      makeArchCheck(hardware.record, arm64Host: hardware.arm64CapableHost, since: tArch))

    let tExt = ContinuousClock.now
    checks.append(makeUpdaterExtensionsCheck(snapshot: snapshot, since: tExt))

    // Layer 2: permissions_and_keychain (Swift TCC & Secure Input checks)
    let tPerm = ContinuousClock.now
    let permissions = ShellEnvironmentProbes.inspectPermissions(
      bundleId: snapshot.bundleIdentifier,
      accessibilityTrusted: snapshot.accessibilityTrusted,
      screenRecordingTrusted: snapshot.screenRecordingTrusted)
    checks.append(
      makeAccessibilityCheck(
        permissions: permissions,
        signature: signature,
        previouslyHeld: snapshot.accessibilityPreviouslyHeld,
        since: tPerm))
    checks.append(
      makeScreenRecordingCheck(
        permissions: permissions,
        previouslyHeld: snapshot.screenRecordingPreviouslyHeld,
        since: tPerm))
    checks.append(
      makeInputPostEventCheck(
        permissions: permissions,
        uuremoteRunning: snapshot.uuremoteRunning,
        uuremoteTapFailed: snapshot.uuremoteTapFailed,
        since: tPerm))
    checks.append(makeSecureInputCheck(permissions: permissions, since: tPerm))

    // Layer 3: service_and_storage (Swift supervisor + computer host lock)
    let tSvc = ContinuousClock.now
    checks.append(
      makeSupervisorCheck(
        snapshot: snapshot,
        nodeInsideBundle: placement.record.runningNodeInsideAppBundle,
        since: tSvc))
    checks.append(makeHostLockCheck(snapshot: snapshot, since: tSvc))

    // Layer 5: network_proxy_and_clock (Swift raw CFNetwork proxy + enterprise CAs + loopback IPC)
    let tProxy = ContinuousClock.now
    let proxyFlags = ShellEnvironmentProbes.inspectSystemProxyFlags()
    let customCaCount = ShellEnvironmentProbes.countCustomAdminRootCertificates()
    checks.append(
      makeProxyCheck(proxyFlags: proxyFlags, customCaCount: customCaCount, since: tProxy))

    let tLoopback = ContinuousClock.now
    let loopbackCheck = await evaluateLoopbackCheck(
      endpoint: snapshot.runningServiceEndpoint, since: tLoopback)
    checks.append(loopbackCheck)

    let envRecord = DiagnosticsEnvironmentRecord(
      capturedAt: capturedAt,
      app: .init(
        bundleIdentifier: snapshot.bundleIdentifier,
        shortVersion: snapshot.appVersion,
        buildVersion: snapshot.buildNumber,
        isDevelopment: snapshot.isDevelopment,
        updaterConfigured: snapshot.updaterConfigured,
        customFeedOverrideSet: snapshot.customFeedOverrideSet),
      host: hardware.record,
      placement: placement.record,
      signing: signature.record,
      permissions: permissions,
      selectionToolbar: snapshot.selectionToolbar,
      displays: snapshot.displays,
      systemProxyFlags: proxyFlags,
      enterpriseCa: .init(customAdminRootCertCount: customCaCount))

    let ringSummaries = summarizeRings(
      decisionRings, heldArbiterClaims: snapshot.heldArbiterClaims)

    return Evaluation(
      capturedAt: capturedAt,
      environmentRecord: envRecord,
      checks: checks,
      rings: ringSummaries)
  }

  static func summarizeRings(
    _ rings: ShellDecisionRings,
    heldArbiterClaims: [String]
  ) -> [DecisionRingSummary] {
    func build<E: SequencedDecisionEntry>(
      id: DecisionRingSummary.RingId,
      snap: DecisionRingSnapshot<E>,
      held: [String] = []
    ) -> DecisionRingSummary {
      let lastTs = snap.entries.last.map { rings.anchor.iso8601String(forUptimeNs: $0.uptimeNs) }
      let anomalies = snap.entries.reduce(0) { $0 + ($1.isAnomaly ? 1 : 0) }
      let scrubbedHeld = held.prefix(16).map {
        DiagnosticsScrubber.scrubInlineSummary($0, maxUTF8Bytes: 64)
      }
      return DecisionRingSummary(
        ringId: id,
        capacity: min(1_024, max(1, snap.capacity)),
        entryCount: min(1_024, snap.entries.count),
        droppedCount: Int(clamping: snap.overwrittenCount),
        lastEventAt: lastTs,
        recentAnomalyCount: anomalies,
        heldResources: scrubbedHeld)
    }

    return [
      build(id: .selection, snap: rings.selection.snapshot()),
      build(id: .hotkeys, snap: rings.hotkeys.snapshot()),
      build(
        id: .captureArbiter, snap: rings.captureArbiter.snapshot(), held: heldArbiterClaims),
      build(id: .relaySupervisor, snap: rings.relaySupervisor.snapshot()),
    ]
  }
}
