import AICore
import AppKit
import Foundation
import Testing
import WebKit

@testable import AIShell

extension ShellController {
  @MainActor
  func tearDownForTesting() {
    services.liveProbes.stop()
    PermissionGuide.shared.onActiveChange = nil
    panelHost.close()
    settings.close()
    onboarding.close()
    panel.panel.contentView = nil
    panel.panel.close()
    services.shellLog.close()
  }
}

@MainActor
@Suite(
  "Multi-window breadcrumbs merge & destination-safe diagnostics export (B9, B16)", .serialized)
struct DiagnosticsBreadcrumbsAndExportSafetyTests {
  @Test(
    "mergeBreadcrumbs & collectDiagnosticsBreadcrumbs preserve panel + settings within caps (B9)")
  func mergeAndCollectBreadcrumbsPreservePanelAndSettingsWithinCaps() async throws {
    let panelCrumb = RendererBreadcrumbsPayload.Entrie(
      seq: 1, ts: "2026-11-18T12:00:01.000Z", category: .streamState, windowRole: .panel,
      code: "ws_closed", name: nil, message: "Panel stream dropped")
    let settingsCrumb = RendererBreadcrumbsPayload.Entrie(
      seq: 1, ts: "2026-11-18T12:00:02.000Z", category: .queryError, windowRole: .settings,
      code: "503", name: "Error", message: "Settings doctor failed")
    let merged = WebViewHost.mergeBreadcrumbs([
      RendererBreadcrumbsPayload(
        capturedAt: "2026-11-18T12:00:02.500Z", droppedCount: 1, entries: [settingsCrumb]),
      RendererBreadcrumbsPayload(
        capturedAt: "2026-11-18T12:00:01.500Z", droppedCount: 2, entries: [panelCrumb]),
    ])
    #expect(merged.entries.map(\.windowRole) == [.panel, .settings])
    #expect(merged.droppedCount == 3)

    // Identical payload passed twice deduplicates without inflating droppedCount.
    let deduped = WebViewHost.mergeBreadcrumbs([
      RendererBreadcrumbsPayload(
        capturedAt: "2026-11-18T12:00:01.500Z", droppedCount: 2, entries: [panelCrumb]),
      RendererBreadcrumbsPayload(
        capturedAt: "2026-11-18T12:00:01.500Z", droppedCount: 2, entries: [panelCrumb]),
    ])
    #expect(deduped.entries.count == 1)
    #expect(deduped.droppedCount == 2)

    // Verify 128-entry + 128 KiB UTF-8 JSON cap when merging two full window rings.
    let bigMsg = String(repeating: "m", count: 300)
    let manyA = (1...90).map { i in
      RendererBreadcrumbsPayload.Entrie(
        seq: i, ts: String(format: "2026-11-18T12:01:%02d.000Z", i % 60), category: .queryError,
        windowRole: .panel, code: String(repeating: "c", count: 60),
        name: String(repeating: "n", count: 60), message: bigMsg)
    }
    let manyB = (1...90).map { i in
      RendererBreadcrumbsPayload.Entrie(
        seq: i, ts: String(format: "2026-11-18T12:02:%02d.000Z", i % 60), category: .mutationError,
        windowRole: .settings, code: String(repeating: "d", count: 60),
        name: String(repeating: "e", count: 60), message: bigMsg)
    }
    let capped = WebViewHost.mergeBreadcrumbs([
      .init(capturedAt: "2026-11-18T12:01:59.000Z", droppedCount: 0, entries: manyA),
      .init(capturedAt: "2026-11-18T12:02:59.000Z", droppedCount: 0, entries: manyB),
    ])
    #expect(capped.entries.count <= 128)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let encodedCapped = try encoder.encode(capped)
    #expect(encodedCapped.count <= WebViewHost.maxBreadcrumbsUTF8Bytes)
    #expect(capped.droppedCount == 180 - capped.entries.count)

    // Verify `ShellController.collectDiagnosticsBreadcrumbs` merges `panelHost` + caller Settings!
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-b9-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let suiteName = "com.junerdd.ai.tests.b9.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let services = ShellServices.development(
      environment: [
        "AI_AGENT_DATA_DIR": tempDir.appending(path: "data").path(percentEncoded: false)
      ],
      home: tempDir)
    let shell = ShellController(services: services, defaults: defaults)
    let settingsHost = WebViewHost(
      role: .settings, fragment: "settings", services: services, bridge: ShellBridge())
    defer {
      settingsHost.close()
      shell.tearDownForTesting()
    }

    shell.panelHost.webView.loadHTMLString(
      """
      <html><script>
      window.__atdReadDiagnosticsBreadcrumbsJson = () => JSON.stringify({
        capturedAt: "2026-11-18T12:00:01.000Z",
        droppedCount: 0,
        entries: [{
          seq: 1, ts: "2026-11-18T12:00:01.000Z", category: "stream_state",
          windowRole: "panel", code: "1011", name: null, message: "Panel disconnected"
        }]
      });
      </script><body>panel</body></html>
      """,
      baseURL: RendererOrigin.pageURL(fragment: nil))
    let loadDeadline = ContinuousClock.now.advanced(by: .seconds(5))
    while (await shell.panelHost.readDiagnosticsBreadcrumbs(timeout: .milliseconds(250)))
      .entries.isEmpty,
      ContinuousClock.now < loadDeadline
    {
      try await Task.sleep(for: .milliseconds(20))
    }

    let collected = await shell.collectDiagnosticsBreadcrumbs(
      callerHost: settingsHost,
      callerPayload: .init(
        capturedAt: "2026-11-18T12:00:03.000Z", droppedCount: 0, entries: [settingsCrumb]))
    #expect(collected.entries.map(\.windowRole) == [.panel, .settings])
    #expect(collected.entries.first?.message == "Panel disconnected")
  }

  @Test("Failed bridge & native exports never delete a pre-existing destination archive (B16)")
  func failedExportPreservesPreExistingDestinationArchive() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-b16-\(UUID().uuidString)", directoryHint: .isDirectory)
    let exportsDir = tempDir.appending(path: "exports", directoryHint: .isDirectory)
    let readOnlyTemp = tempDir.appending(path: "readonly-staging", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: exportsDir, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: readOnlyTemp, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o500])
    defer {
      try? FileManager.default.setAttributes(
        [.posixPermissions: 0o700], ofItemAtPath: readOnlyTemp.path())
      try? FileManager.default.removeItem(at: tempDir)
    }

    let existingZip = exportsDir.appending(path: "existing-user-bundle.zip")
    try "PRECIOUS_EXISTING_USER_ARCHIVE".write(to: existingZip, atomically: true, encoding: .utf8)

    let suiteName = "com.junerdd.ai.tests.b16.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let services = ShellServices.development(
      environment: [
        "AI_AGENT_DATA_DIR": tempDir.appending(path: "data").path(percentEncoded: false)
      ],
      home: tempDir)
    services.diagnosticsTemporaryDirectoryURL = readOnlyTemp
    services.nativeDiagnosticsConsentOverrideForTesting = { false }
    let shell = ShellController(services: services, defaults: defaults)
    shell.systemPanels.emergencySaveURLOverrideForTesting = { _ in existingZip }
    let settingsHost = WebViewHost(
      role: .settings, fragment: "settings", services: services, bridge: ShellBridge())
    defer {
      settingsHost.close()
      shell.tearDownForTesting()
    }

    await #expect(throws: BridgeError.self) {
      _ = try await ShellBridge.handleDiagnostics(
        .exportBundle(
          .init(rendererBreadcrumbs: WebViewHost.emptyBreadcrumbs(), includeCrashSummaries: false)),
        from: settingsHost,
        document: settingsHost.document,
        shell: shell)
    }
    #expect(
      try String(contentsOf: existingZip, encoding: .utf8) == "PRECIOUS_EXISTING_USER_ARCHIVE")

    await #expect(throws: (any Error).self) {
      _ = try await shell.exportDiagnosticsFromNativeUI(triggerSurface: .menu)
    }
    #expect(
      try String(contentsOf: existingZip, encoding: .utf8) == "PRECIOUS_EXISTING_USER_ARCHIVE")
  }
}
