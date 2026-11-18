import AICore
import AIRelay
import AppKit
import Foundation
import Testing
import WebKit

@testable import AIShell

@Suite("Diagnostics exporter, 1s JS breadcrumb timeout & arbiter bypass", .serialized)
struct DiagnosticsExporterTests {
  private static func makeSampleSnapshot(
    dataDir: URL, homeDir: URL
  ) -> ShellEnvironmentChecks.MainActorSnapshot {
    ShellEnvironmentChecks.MainActorSnapshot(
      bundleIdentifier: "com.junerdd.ai.dev",
      bundleURL: URL(filePath: "/Applications/Atd.app"),
      builtInPlugInsURL: nil,
      homePath: homeDir.path(percentEncoded: false),
      dataDirectory: dataDir,
      appVersion: "0.12.0",
      buildNumber: "120",
      isDevelopment: true,
      updaterConfigured: false,
      customFeedOverrideSet: false,
      widgetsAvailable: true,
      accessibilityTrusted: true,
      accessibilityPreviouslyHeld: true,
      screenRecordingTrusted: true,
      screenRecordingPreviouslyHeld: true,
      storedRequirement: nil,
      uuremoteRunning: false,
      uuremoteTapFailed: false,
      selectionToolbar: .init(
        settingsReceived: true, enabled: true, activationMode: "always",
        toggleListeningOn: nil, monitorInstalled: true, excludedAppCount: 0),
      displays: [
        .init(
          index: 0, widthPoints: 1512, heightPoints: 982, backingScaleFactor: 2.0,
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
      heldArbiterClaims: ["interactiveScreen:screenshot"])
  }

  private static func writeSyntheticIpsReport(in dir: URL, fixtureHome: String) throws {
    let header = #"{"app_name":"Atd","timestamp":"2026-11-18 12:00:00.00 +0000","bug_type":"309"}"#
    let payload = """
      {
        "procName": "Atd",
        "captureTime": "2026-11-18 12:00:00.000 +0000",
        "exception": { "type": "EXC_BAD_ACCESS", "signal": "SIGSEGV" },
        "termination": { "namespace": "SIGNAL", "code": 11 },
        "asi": { "libsystem_c.dylib": ["SECRET_ASI_MEMORY_STRING \(fixtureHome)/private.txt"] },
        "faultingThread": 0,
        "usedImages": [
          { "name": "AIShell", "path": "\(fixtureHome)/Applications/Atd.app/Contents/MacOS/Atd" },
          { "name": "Foundation", "path": "/System/Library/Frameworks/Foundation.framework/Foundation" }
        ],
        "threads": [
          {
            "triggered": true,
            "threadState": { "x": [123456789] },
            "frames": [
              { "imageIndex": 0, "imageOffset": 4096, "symbolLocation": 64 },
              { "imageIndex": 1, "imageOffset": 8192, "symbolLocation": 16 }
            ]
          }
        ]
      }
      """
    let url = dir.appending(path: "Atd-2026-11-18-120000.ips")
    try "\(header)\n\(payload)\n".write(to: url, atomically: true, encoding: .utf8)
  }

  @Test("Preview writes zero disk archives while exportZip builds a scrubbed ditto .zip <= 8 MiB")
  func previewAndExportZipRespectOptInScrubbingAndHardExcludes() async throws {
    let tempRoot = FileManager.default.temporaryDirectory
      .appending(path: "atd-exporter-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempRoot) }

    let dataDir = tempRoot.appending(path: "data", directoryHint: .isDirectory)
    let authDir = dataDir.appending(path: "auth", directoryHint: .isDirectory)
    let crashDir = tempRoot.appending(path: "DiagnosticReports", directoryHint: .isDirectory)
    let outDir = tempRoot.appending(path: "exports", directoryHint: .isDirectory)
    for dir in [dataDir, authDir, crashDir, outDir] {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    let fixtureHome = "/" + "Users" + "/fixture_acct"
    let syntheticSecret = "sk-ant-" + "api03-" + String(repeating: "k", count: 36)

    // Populate forbidden data files that must NEVER enter the archive.
    try "forbidden-auth-file".write(
      to: authDir.appending(path: "token"), atomically: true, encoding: .utf8)
    try #"{"conversation":"TOP_SECRET_CONVERSATION_LEDGER"}"#.write(
      to: dataDir.appending(path: "ledger.json"), atomically: true, encoding: .utf8)
    try Self.writeSyntheticIpsReport(in: crashDir, fixtureHome: fixtureHome)

    let logURL = tempRoot.appending(path: "logs/shell.jsonl")
    let shellLog = ShellLogWriter(logFileURL: logURL)
    shellLog.enqueue(
      level: .error,
      category: "web",
      message: "Credential \(syntheticSecret) failed at \(fixtureHome)/work")
    _ = shellLog.flush(timeout: .seconds(1))

    let rings = await MainActor.run { ShellDecisionRings() }
    let snapshot = Self.makeSampleSnapshot(dataDir: dataDir, homeDir: tempRoot)
    let breadcrumbs = RendererBreadcrumbsPayload(
      capturedAt: "2026-11-18T12:00:00.000Z",
      droppedCount: 0,
      entries: [
        RendererBreadcrumbsPayload.Entrie(
          seq: 1,
          ts: "2026-11-18T12:00:00.000Z",
          category: .streamState,
          windowRole: .settings,
          code: "ws_open",
          name: nil,
          message: "Opened diagnostics stream")
      ])

    var request = DiagnosticsExporter.ExportRequest(
      triggerSurface: .settings,
      includeCrashSummaries: false,
      rendererBreadcrumbs: breadcrumbs,
      mainActorSnapshot: snapshot,
      decisionRings: rings,
      shellLog: shellLog,
      serviceLogDirectoryURL: nil,
      dataDirectoryURL: dataDir,
      crashReportsDirectoryURL: crashDir,
      recentServiceExits: [],
      serviceEndpoint: nil,
      serviceUnavailable: .developmentServiceNotRunning,
      lastFailureSummary: nil,
      generatedAt: Date())

    // 1. Preview without crash opt-in: zero disk exports, `crashes/summary.json` omittedNotOptedIn.
    let previewNoCrash = try await DiagnosticsExporter.preview(request: request)
    #expect(previewNoCrash.totalUncompressedBytes <= 8_388_608)
    let excerptBytes = previewNoCrash.files.reduce(0) {
      $0 + ($1.previewExcerpt?.utf8.count ?? 0)
    }
    #expect(excerptBytes <= 131_072)
    let crashItem = try #require(previewNoCrash.files.first { $0.path == "crashes/summary.json" })
    #expect(crashItem.status == BundlePreviewFile.Status.omittedNotOptedIn)
    let outContentsBefore = try FileManager.default.contentsOfDirectory(atPath: outDir.path())
    #expect(outContentsBefore.isEmpty)

    // 2. Export `.zip` with crash opt-in enabled.
    request.includeCrashSummaries = true
    let zipURL = outDir.appending(path: "atd-diagnostics-test.zip")
    let archive = try await DiagnosticsExporter.exportZip(
      request: request, destinationZipURL: zipURL)
    #expect(FileManager.default.fileExists(atPath: zipURL.path()))
    #expect(archive.archiveBytes > 0)
    #expect(archive.archiveBytes <= 8_388_608)

    let unpackDir = tempRoot.appending(path: "unpacked", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: unpackDir, withIntermediateDirectories: true)
    let ditto = Process()
    ditto.executableURL = URL(filePath: "/usr/bin/ditto")
    ditto.arguments = ["-x", "-k", zipURL.path(percentEncoded: false), unpackDir.path()]
    try ditto.run()
    ditto.waitUntilExit()
    #expect(ditto.terminationStatus == 0)

    let topEntries = try FileManager.default.contentsOfDirectory(
      at: unpackDir, includingPropertiesForKeys: nil)
    let bundleRoot = try #require(topEntries.first)

    #expect(
      FileManager.default.fileExists(atPath: bundleRoot.appending(path: "manifest.json").path()))
    #expect(
      FileManager.default.fileExists(
        atPath: bundleRoot.appending(path: "doctor-report.json").path()))
    #expect(
      FileManager.default.fileExists(atPath: bundleRoot.appending(path: "environment.json").path()))
    #expect(
      FileManager.default.fileExists(atPath: bundleRoot.appending(path: "auth/token").path())
        == false)
    #expect(
      FileManager.default.fileExists(atPath: bundleRoot.appending(path: "ledger.json").path())
        == false)

    let scrubbedShellLog = try String(
      contentsOf: bundleRoot.appending(path: "logs/shell.tail.jsonl"), encoding: .utf8)
    #expect(!scrubbedShellLog.contains(syntheticSecret))
    #expect(!scrubbedShellLog.contains("fixture_acct"))

    let crashSummary = try String(
      contentsOf: bundleRoot.appending(path: "crashes/summary.json"), encoding: .utf8)
    #expect(crashSummary.contains("AIShell"))
    #expect(!crashSummary.contains("SECRET_ASI_MEMORY_STRING"))
    #expect(!crashSummary.contains("threadState"))
    #expect(!crashSummary.contains("fixture_acct"))

    shellLog.close()
  }

  @MainActor
  @Test(
    "WebViewHost.readBreadcrumbs enforces 1s ContinuousClock timeout, origin lock & 128 KiB cap")
  func readBreadcrumbsTimeoutOriginLockAndSizeCap() async throws {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    let webView = WKWebView(
      frame: NSRect(x: 0, y: 0, width: 200, height: 200), configuration: config)

    // 1. Origin lock rejects non-`ai-app://renderer` URLs before evaluating script.
    webView.loadHTMLString(
      "<html><body>untrusted</body></html>", baseURL: URL(string: "https://example.com"))
    try await Task.sleep(for: .milliseconds(80))
    let rejected = await WebViewHost.readBreadcrumbs(
      from: webView, verifyRendererOrigin: true, timeout: .milliseconds(300))
    #expect(rejected.entries.isEmpty)

    // 2. Hung JS Promise times out cleanly instead of stalling diagnostics export.
    webView.loadHTMLString(
      """
      <html><script>
      window.__atdReadDiagnosticsBreadcrumbsJson = () => new Promise(() => {});
      </script><body>hung</body></html>
      """,
      baseURL: nil)
    try await Task.sleep(for: .milliseconds(80))
    let start = ContinuousClock.now
    let timedOut = await WebViewHost.readBreadcrumbs(
      from: webView, verifyRendererOrigin: false, timeout: .milliseconds(140))
    let elapsed = start.duration(to: ContinuousClock.now)
    #expect(timedOut.entries.isEmpty)
    #expect(elapsed < .seconds(2))

    // 3. Oversized > 131_072 UTF-8 byte payload is rejected cleanly.
    webView.loadHTMLString(
      """
      <html><script>
      window.__atdReadDiagnosticsBreadcrumbsJson = () => "x".repeat(140000);
      </script><body>oversized</body></html>
      """,
      baseURL: nil)
    try await Task.sleep(for: .milliseconds(80))
    let oversized = await WebViewHost.readBreadcrumbs(
      from: webView, verifyRendererOrigin: false, timeout: .milliseconds(300))
    #expect(oversized.entries.isEmpty)
  }

  @MainActor
  @Test(
    "SystemPanels emergency save admission bypasses wedged DeviceArbiter and rejects reentrancy")
  func emergencySavePanelBypassesWedgedArbiterAndRejectsReentrancy() throws {
    let ring = CaptureAndArbiterRing()
    let arbiter = DeviceArbiter(decisionRing: ring)
    let panels = SystemPanels(lowerPanel: {}, restorePanel: {}, arbiter: arbiter)

    // Hold `.interactiveScreen` as if a screenshot session wedged.
    let wedgedClaim = try arbiter.tryClaim([.interactiveScreen], owner: .user(.screenshot))
    defer { wedgedClaim.release() }

    let bypassClaim = try panels.prepareEmergencySaveAdmission(ring: ring)
    #expect(bypassClaim == nil)
    let lastEntry = try #require(ring.snapshot().entries.last)
    #expect(
      lastEntry.ownerSummary.stringValue.hasPrefix("emergency_save_panel_bypassed_arbiter:"))
    #expect(lastEntry.isAnomaly == true)

    // Reentrancy (`isOpen == true`) throws localized `EmergencySavePanelBusyError`.
    panels.isOpen = true
    defer { panels.isOpen = false }
    #expect(throws: EmergencySavePanelBusyError.self) {
      _ = try panels.prepareEmergencySaveAdmission(ring: ring)
    }
  }
}
