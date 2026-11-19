import AICore
import AIRelay
import AppKit
import Foundation
import Testing

@testable import AIShell

@MainActor
@Suite("LiveProbeCoordinator 10s auto-disarm, mutual exclusion & privacy", .serialized)
struct LiveProbeCoordinatorTests {
  private static func extractSummary(
    _ event: DiagnosticsLiveProbeEventEvent
  ) -> (probeId: String, endedReason: String) {
    switch event {
    case .selection(let payload): (payload.probeId, payload.endedReason.rawValue)
    case .hotkey(let payload): (payload.probeId, payload.endedReason.rawValue)
    case .capture(let payload): (payload.probeId, payload.endedReason.rawValue)
    }
  }

  @Test("Idle coordinator holds zero active sessions and anonymizes third-party bundle IDs")
  func idleZeroOverheadAndBundleIdAnonymization() throws {
    let coordinator = LiveProbeCoordinator()
    #expect(coordinator.isArmed == false)
    #expect(coordinator.activeProbeId == nil)
    #expect(coordinator.active == nil)

    // Apple & Atd bundle IDs pass through; third-party apps hash to `app#<8hex>`.
    #expect(BundleIdentifierRedactor.redact("com.apple.Safari") == "com.apple.Safari")
    #expect(BundleIdentifierRedactor.redact("com.junerdd.ai.dev") == "com.junerdd.ai.dev")
    let redacted = try #require(BundleIdentifierRedactor.redact("com.acme.SecretInternalCRM"))
    #expect(redacted.hasPrefix("app#"))
    #expect(redacted.count == 12)
    #expect(redacted.contains("acme") == false)
    #expect(redacted.contains("SecretInternalCRM") == false)
  }

  @Test("Starting a second probe disarms the first, and stop() disarms cleanly")
  func mutualExclusionAndExplicitStop() throws {
    let coordinator = LiveProbeCoordinator()
    var summaries: [(probeId: String, endedReason: String)] = []
    coordinator.onEventForTesting = { summaries.append(Self.extractSummary($0)) }

    let first = coordinator.start(
      kind: .selection, host: nil, shell: nil, duration: .seconds(10))
    #expect(coordinator.isArmed == true)
    #expect(coordinator.activeProbeId == first.probeId)
    #expect(summaries.last?.probeId == first.probeId)
    #expect(summaries.last?.endedReason == "running")

    // Starting `.hotkey` disarms `.selection` with `"stopped"` before arming `.hotkey`.
    let second = coordinator.start(
      kind: .hotkey, host: nil, shell: nil, duration: .seconds(10))
    #expect(second.probeId != first.probeId)
    #expect(coordinator.activeProbeId == second.probeId)
    #expect(
      summaries.contains(where: { $0.probeId == first.probeId && $0.endedReason == "stopped" }))
    #expect(
      summaries.contains(where: { $0.probeId == second.probeId && $0.endedReason == "running" }))

    coordinator.stop()
    #expect(coordinator.isArmed == false)
    #expect(coordinator.active == nil)
    let last = try #require(summaries.last)
    #expect(last.probeId == second.probeId)
    #expect(last.endedReason == "stopped")
  }

  @Test("Closing the owning WebViewHost immediately disarms with window_closed")
  func windowCloseImmediatelyDisarmsActiveProbe() throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-liveprobe-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let dataDir = tempDir.appending(path: "AgentServiceDev", directoryHint: .isDirectory)
    let services = ShellServices.development(
      environment: ["AI_AGENT_DATA_DIR": dataDir.path(percentEncoded: false)],
      home: tempDir)
    let bridge = ShellBridge()
    let host = WebViewHost(
      role: .settings, fragment: "settings", services: services, bridge: bridge)

    var summaries: [(probeId: String, endedReason: String)] = []
    services.liveProbes.onEventForTesting = { summaries.append(Self.extractSummary($0)) }

    let started = services.liveProbes.start(
      kind: .capture, host: host, shell: nil, duration: .seconds(10))
    #expect(services.liveProbes.isArmed == true)

    host.close()
    #expect(services.liveProbes.isArmed == false)
    #expect(
      summaries.contains(where: {
        $0.probeId == started.probeId && $0.endedReason == "window_closed"
      }))
  }

  @Test("ContinuousClock watchdog auto-disarms expired probes with timeout")
  func continuousClockTimeoutAutoDisarms() async throws {
    let coordinator = LiveProbeCoordinator()
    var summaries: [(probeId: String, endedReason: String)] = []
    coordinator.onEventForTesting = { summaries.append(Self.extractSummary($0)) }

    let started = coordinator.start(
      kind: .selection, host: nil, shell: nil, duration: .milliseconds(80))
    #expect(coordinator.isArmed == true)

    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while coordinator.isArmed, ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(15))
    }

    #expect(coordinator.isArmed == false)
    #expect(coordinator.active == nil)
    let terminal = try #require(summaries.last)
    #expect(terminal.probeId == started.probeId)
    #expect(terminal.endedReason == "timeout")
  }

  @Test("Selection live probe delivers sub-50ms cancellation and gate-rejection outcomes (B20)")
  func selectionProbeDeliversRapidDiscreteFailureTransitions() throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-liveprobe-b20-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let suiteName = "com.junerdd.ai.tests.b20.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let dataDir = tempDir.appending(path: "AgentServiceDev", directoryHint: .isDirectory)
    let services = ShellServices.development(
      environment: ["AI_AGENT_DATA_DIR": dataDir.path(percentEncoded: false)], home: tempDir)
    let shell = ShellController(services: services, defaults: defaults)
    defer { shell.tearDownForTesting() }

    var selectionOutcomes: [String] = []
    services.liveProbes.onEventForTesting = { event in
      if case .selection(let payload) = event {
        selectionOutcomes.append(payload.gateOutcome)
      }
    }

    _ = services.liveProbes.start(kind: .selection, host: nil, shell: shell, duration: .seconds(10))
    let emit = try #require(shell.toolbar.probeRunner.onLiveProbeStep)

    // Fire 4 discrete selection transitions back-to-back (< 1 ms apart, well within 50 ms).
    for outcome in [
      "attempt0_empty_debouncing",
      "debounce_interrupted_key",
      "activation_blocked",
      "secure_input_active",
    ] {
      emit(
        .init(
          axTrusted: true, frontmostBundleId: "com.apple.Safari", excludedByAppRule: false,
          axRole: nil, selectedLength: 0, gateOutcome: outcome))
    }

    #expect(
      selectionOutcomes.suffix(4) == [
        "attempt0_empty_debouncing",
        "debounce_interrupted_key",
        "activation_blocked",
        "secure_input_active",
      ])
  }

  @Test(
    "handleDiagnostics(.liveProbeStart) rejects closed or reloaded documents before arming (B32)")
  func liveProbeStartRejectsClosedOrReloadedDocument() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-liveprobe-b32-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let suiteName = "com.junerdd.ai.tests.b32.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let dataDir = tempDir.appending(path: "AgentServiceDev", directoryHint: .isDirectory)
    let services = ShellServices.development(
      environment: ["AI_AGENT_DATA_DIR": dataDir.path(percentEncoded: false)], home: tempDir)
    let shell = ShellController(services: services, defaults: defaults)
    let bridge = ShellBridge()
    let host = WebViewHost(
      role: .settings, fragment: "settings", services: services, bridge: bridge)
    defer {
      host.close()
      shell.tearDownForTesting()
    }

    let staleDocument = host.document
    host.pageDidUnload()
    #expect(host.document != staleDocument)

    await #expect(throws: BridgeError.self) {
      _ = try await ShellBridge.handleDiagnostics(
        .liveProbeStart(.init(kind: .hotkey)),
        from: host,
        document: staleDocument,
        shell: shell)
    }
    #expect(services.liveProbes.isArmed == false)

    let closingDocument = host.document
    host.close()
    await #expect(throws: BridgeError.self) {
      _ = try await ShellBridge.handleDiagnostics(
        .liveProbeStart(.init(kind: .capture)),
        from: host,
        document: closingDocument,
        shell: shell)
    }
    #expect(services.liveProbes.isArmed == false)
  }
}
