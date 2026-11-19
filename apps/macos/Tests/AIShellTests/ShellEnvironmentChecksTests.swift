import AICore
import AIRelay
import Foundation
import Testing

@testable import AIShell

@Suite("ShellEnvironmentChecks off-main evaluation & host probes")
struct ShellEnvironmentChecksTests {
  private static func makeSnapshot(
    tempDir: URL,
    isDevelopment: Bool = true
  ) -> ShellEnvironmentChecks.MainActorSnapshot {
    let fixtureHome = "/" + "Users" + "/fixture_acct/task"
    return ShellEnvironmentChecks.MainActorSnapshot(
      bundleIdentifier: "com.junerdd.ai.dev",
      bundleURL: URL(filePath: "/Applications/Atd.app"),
      builtInPlugInsURL: nil,
      homePath: tempDir.path(percentEncoded: false),
      dataDirectory: tempDir,
      appVersion: "0.12.0",
      buildNumber: "120",
      isDevelopment: isDevelopment,
      updaterConfigured: true,
      customFeedOverrideSet: false,
      widgetsAvailable: true,
      accessibilityTrusted: true,
      accessibilityPreviouslyHeld: false,
      screenRecordingTrusted: true,
      screenRecordingPreviouslyHeld: false,
      storedRequirement: nil,
      uuremoteRunning: false,
      uuremoteTapFailed: false,
      selectionToolbar: .init(
        settingsReceived: true, enabled: true, activationMode: "always",
        toggleListeningOn: nil, monitorInstalled: true, excludedAppCount: 1),
      displays: [
        .init(
          index: 0, widthPoints: 1440, heightPoints: 900, backingScaleFactor: 2.0,
          isBuiltin: true, sdrSnapshotSupported: true)
      ],
      serviceState: .running,
      serviceFailureCode: nil,
      serviceFailureSummary: nil,
      runningServiceEndpoint: nil,
      allowedExecutableRoot: nil,
      controlReconnecting: false,
      hostLockHeldByOther: false,
      unsettledSessionPending: false,
      heldArbiterClaims: ["interactiveScreen:\(fixtureHome)"])
  }

  @Test("evaluate completes in <= 1,500 ms with all 12 shell checks and 4 scrubbed ring summaries")
  func evaluateProducesAllTwelveChecksWithinBudget() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-env-checks-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let rings = await MainActor.run { () -> ShellDecisionRings in
      let r = ShellDecisionRings()
      var sel = SelectionDecisionEntry()
      sel.uptimeNs = MonotonicTimestampAnchor.nowUptimeNs()
      sel.flags = SelectionGateFlags.secureInput.rawValue
      sel.dropStage = 4
      r.selection.append(sel)
      return r
    }

    let snapshot = Self.makeSnapshot(tempDir: tempDir)
    let start = ContinuousClock.now
    let evaluation = await ShellEnvironmentChecks.evaluate(
      snapshot: snapshot, decisionRings: rings)
    let elapsed = start.duration(to: ContinuousClock.now)

    #expect(elapsed < .milliseconds(1_500))
    let expectedIds: [String] = [
      "install.app_placement",
      "install.code_signature",
      "install.arch_and_rosetta",
      "install.updater_and_extensions",
      "perm.accessibility",
      "perm.screen_recording",
      "perm.input_and_post_event",
      "perm.secure_event_input",
      "service.supervisor_and_pid_origin",
      "service.computer_host_lock",
      "net.system_proxy_alignment",
      "net.loopback_ipc",
    ]
    #expect(evaluation.checks.map(\.id) == expectedIds)
    #expect(
      evaluation.rings.map(\.ringId) == [
        .selection, .hotkeys, .captureArbiter, .relaySupervisor,
      ])

    let selectionSummary = try #require(evaluation.rings.first { $0.ringId == .selection })
    #expect(selectionSummary.entryCount == 1)
    #expect(selectionSummary.recentAnomalyCount == 1)

    let arbiterSummary = try #require(evaluation.rings.first { $0.ringId == .captureArbiter })
    #expect(arbiterSummary.heldResources.count == 1)
    #expect(arbiterSummary.heldResources[0].contains("fixture_acct") == false)
  }

  @Test("Check builders classify translocation, stale grants, foreign node PIDs, and PAC fallback")
  func checkBuildersClassifyHighSignalFailureModes() throws {
    let tempDir = FileManager.default.temporaryDirectory
    let now = ContinuousClock.now

    let translocated = ShellEnvironmentChecks.makePlacementCheck(
      .init(
        record: .init(
          locationCategory: "other",
          isTranslocated: true,
          isReadOnlyMount: false,
          hasQuarantineAttribute: true,
          widgetsIndexedLocation: false,
          runningNodeInsideAppBundle: nil)),
      isDev: false,
      since: now)
    #expect(translocated.status == ShellDoctorCheck.Status.fail)
    #expect(translocated.reasonCode == "app_translocated")
    #expect(translocated.remediation?.action == .moveToApplications)

    let staleAx = ShellEnvironmentChecks.makeAccessibilityCheck(
      permissions: .init(
        accessibilityTrusted: false,
        duplicateAppBundlesCount: 2,
        screenRecordingTrusted: true,
        listenEventTrusted: true,
        postEventTrusted: true,
        secureEventInputEnabled: false),
      signature: .init(
        valid: true,
        isAdHoc: false,
        requirement: nil,
        record: .init(
          designatedRequirementReadable: true,
          requirementMatchesStored: true)),
      previouslyHeld: false,
      since: now)
    #expect(staleAx.status == ShellDoctorCheck.Status.fail)
    #expect(staleAx.reasonCode == "stale_or_duplicate_app_grant")
    #expect(staleAx.remediation?.action == .openSystemSettingsAccessibility)

    let foreignNode = ShellEnvironmentChecks.makeSupervisorCheck(
      snapshot: Self.makeSnapshot(tempDir: tempDir, isDevelopment: false),
      nodeInsideBundle: false,
      since: now)
    #expect(foreignNode.status == ShellDoctorCheck.Status.fail)
    #expect(foreignNode.reasonCode == "adopted_foreign_bundle_node")
    #expect(foreignNode.remediation?.action == .restartService)

    let pacOnly = ShellEnvironmentChecks.makeProxyCheck(
      proxyFlags: .init(
        pacEnabled: true, wpadEnabled: false, httpProxyEnabled: false,
        httpsProxyEnabled: false, socksProxyEnabled: false),
      customCaCount: 2,
      since: now)
    #expect(pacOnly.status == ShellDoctorCheck.Status.warn)
    #expect(pacOnly.reasonCode == "pac_or_wpad_fallback_to_direct")

    // B17: PostEvent & UU Remote `.defaultTap` checks route to Accessibility, while ListenEvent
    // routes to Input Monitoring.
    let tapFailed = ShellEnvironmentChecks.makeInputPostEventCheck(
      permissions: .init(
        accessibilityTrusted: true, duplicateAppBundlesCount: 1, screenRecordingTrusted: true,
        listenEventTrusted: true, postEventTrusted: true, secureEventInputEnabled: false),
      uuremoteRunning: true,
      uuremoteTapFailed: true,
      since: now)
    #expect(tapFailed.status == .warn)
    #expect(tapFailed.reasonCode == "uuremote_tap_install_failed")
    #expect(tapFailed.remediation?.remediationCode == "grant_or_reset_accessibility")
    #expect(tapFailed.remediation?.action == .openSystemSettingsAccessibility)

    let postDenied = ShellEnvironmentChecks.makeInputPostEventCheck(
      permissions: .init(
        accessibilityTrusted: true, duplicateAppBundlesCount: 1, screenRecordingTrusted: true,
        listenEventTrusted: true, postEventTrusted: false, secureEventInputEnabled: false),
      uuremoteRunning: false,
      uuremoteTapFailed: false,
      since: now)
    #expect(postDenied.status == .warn)
    #expect(postDenied.reasonCode == "post_event_denied")
    #expect(postDenied.remediation?.remediationCode == "grant_or_reset_accessibility")
    #expect(postDenied.remediation?.action == .openSystemSettingsAccessibility)

    let listenDenied = ShellEnvironmentChecks.makeInputPostEventCheck(
      permissions: .init(
        accessibilityTrusted: true, duplicateAppBundlesCount: 1, screenRecordingTrusted: true,
        listenEventTrusted: false, postEventTrusted: true, secureEventInputEnabled: false),
      uuremoteRunning: false,
      uuremoteTapFailed: false,
      since: now)
    #expect(listenDenied.status == .warn)
    #expect(listenDenied.reasonCode == "listen_event_denied")
    #expect(listenDenied.remediation?.remediationCode == "grant_input_monitoring")
    #expect(listenDenied.remediation?.action == .openSystemSettingsInputMonitoring)
  }

  @MainActor
  @Test("StaleGrantRecovery preserves pre-overwrite launch grant history for Doctor checks (B18)")
  func staleGrantRecoveryPreservesLaunchHistoryAcrossOverwrites() throws {
    let suiteName = "com.junerdd.ai.tests.b18.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let priorRequirement = #"anchor apple generic and cdhash H"prior_build_cdhash""#
    defaults.set(priorRequirement, forKey: "privacyGrants.requirement")
    defaults.set(["accessibility", "screenRecording"], forKey: "privacyGrants.held")

    // Capture initial launch history BEFORE StaleGrantRecovery overwrites UserDefaults.
    StaleGrantRecovery.captureLaunchHistory(
      defaults: defaults, accessibilityTrusted: false, screenRecordingTrusted: false)

    // Simulate startup + didBecomeActive overwrites in UserDefaults.
    defaults.set(
      #"anchor apple generic and cdhash H"current_build_cdhash""#,
      forKey: "privacyGrants.requirement")
    defaults.set([String](), forKey: "privacyGrants.held")
    StaleGrantRecovery.captureLaunchHistory(
      defaults: defaults, accessibilityTrusted: false, screenRecordingTrusted: false)

    let history = StaleGrantRecovery.diagnosticsHistory(
      defaults: defaults, accessibilityTrusted: false, screenRecordingTrusted: false)
    #expect(history.storedRequirement == priorRequirement)
    #expect(history.previouslyHeld == [.accessibility, .screenRecording])

    let now = ContinuousClock.now
    let driftedSig = ShellEnvironmentChecks.makeSignatureCheck(
      .init(
        valid: true, isAdHoc: true, requirement: "current",
        record: .init(designatedRequirementReadable: true, requirementMatchesStored: false)),
      isDev: true,
      since: now)
    #expect(driftedSig.status == .warn)
    #expect(driftedSig.reasonCode == "requirement_drifted")

    let lostAx = ShellEnvironmentChecks.makeAccessibilityCheck(
      permissions: .init(
        accessibilityTrusted: false, duplicateAppBundlesCount: 1, screenRecordingTrusted: false,
        listenEventTrusted: false, postEventTrusted: false, secureEventInputEnabled: false),
      signature: .init(
        valid: true, isAdHoc: false, requirement: priorRequirement,
        record: .init(designatedRequirementReadable: true, requirementMatchesStored: true)),
      previouslyHeld: history.previouslyHeld.contains(.accessibility),
      since: now)
    #expect(lostAx.status == .fail)
    #expect(lostAx.reasonCode == "stale_or_duplicate_app_grant")

    let pendingScreen = ShellEnvironmentChecks.makeScreenRecordingCheck(
      permissions: .init(
        accessibilityTrusted: false, duplicateAppBundlesCount: 1, screenRecordingTrusted: false,
        listenEventTrusted: false, postEventTrusted: false, secureEventInputEnabled: false),
      previouslyHeld: history.previouslyHeld.contains(.screenRecording),
      since: now)
    #expect(pendingScreen.status == .warn)
    #expect(pendingScreen.reasonCode == "granted_pending_relaunch")
  }

  @Test("Diagnostics sources never branch on ProcessInfo.operatingSystemVersion (AGENTS.md:129)")
  func zeroOperatingSystemVersionBranchingInDiagnosticsSources() throws {
    let diagnosticsDir = URL(filePath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appending(path: "Sources/AIShell/Diagnostics", directoryHint: .isDirectory)
    let files = try FileManager.default.contentsOfDirectory(
      at: diagnosticsDir, includingPropertiesForKeys: nil
    )
    .filter { $0.pathExtension == "swift" }
    #expect(!files.isEmpty)
    for file in files {
      let source = try String(contentsOf: file, encoding: .utf8)
      let nonCommentCode = source.split(separator: "\n")
        .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
        .joined(separator: "\n")
      #expect(
        nonCommentCode.contains(try Regex(#"\.operatingSystemVersion\b"#)) == false,
        "\(file.lastPathComponent) must use capability checks instead of .operatingSystemVersion")
    }
  }
}
