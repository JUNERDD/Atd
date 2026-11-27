import AICore
import AIRelay
import Darwin
import Foundation
import Testing

@testable import AIShell

@Suite("Doctor check reconciliation & 2.5s service timeout (B7, B8)", .serialized)
struct DiagnosticsDoctorMergeTests {
  private static func makeSnapshot(
    dataDir: URL,
    homeDir: URL,
    endpoint: ServiceEndpoint? = nil
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
      displays: [],
      serviceState: .running,
      serviceFailureCode: nil,
      serviceFailureSummary: nil,
      runningServiceEndpoint: endpoint,
      allowedExecutableRoot: nil,
      controlReconnecting: false,
      hostLockHeldByOther: false,
      unsettledSessionPending: false,
      heldArbiterClaims: [])
  }

  static func makeServiceDoctorJSON(
    proxyStatus: String = "pass",
    proxyReason: String = "ok",
    proxyDurationMs: Double = 29,
    proxyRemediation: [String: Any]? = nil
  ) throws -> Data {
    let idsAndLayers: [(String, String)] = [
      ("service.lock_and_recovery", "service_and_storage"),
      ("service.storage_and_disk", "service_and_storage"),
      ("shell.login_path_resolution", "shell_and_toolchain"),
      ("shell.node_runtime", "shell_and_toolchain"),
      ("shell.ripgrep_binary", "shell_and_toolchain"),
      ("shell.host_cli_tools", "shell_and_toolchain"),
      ("net.system_proxy_alignment", "network_proxy_and_clock"),
      ("net.child_process_proxy_and_ca", "network_proxy_and_clock"),
      ("native.file_index_addon", "native_addons_and_index"),
      ("conn.mirror_tls_and_clock_skew", "on_demand_connectivity"),
      ("perm.keychain_and_launch_key", "permissions_and_keychain"),
      ("native.memory_index_health", "native_addons_and_index"),
      ("native.optional_addons", "native_addons_and_index"),
      ("native.mcp_and_wps_bridges", "native_addons_and_index"),
      ("conn.provider_endpoints", "on_demand_connectivity"),
    ]
    let checks: [[String: Any]] = idsAndLayers.map { id, layer in
      if id == "net.system_proxy_alignment" {
        var obj: [String: Any] = [
          "id": id,
          "layer": layer,
          "status": proxyStatus,
          "reasonCode": proxyReason,
          "durationMs": proxyDurationMs,
          "metrics": [
            "mode": "direct",
            "httpConfigured": false,
            "httpsConfigured": false,
            "exceptionsCount": 0,
            "skippedBypassCount": proxyStatus == "warn" ? 2 : 0,
          ],
        ]
        if let proxyRemediation { obj["remediation"] = proxyRemediation }
        return obj
      }
      return [
        "id": id,
        "layer": layer,
        "status": layer == "on_demand_connectivity" ? "skipped" : "pass",
        "reasonCode": layer == "on_demand_connectivity" ? "not_requested" : "ok",
        "durationMs": 4,
        "metrics": ["ok": true],
      ]
    }
    return try JSONSerialization.data(
      withJSONObject: [
        "ranAt": "2026-11-18T12:00:00.000Z",
        "serviceEpoch": 1,
        "durationMs": 1_500,
        "includeConnectivity": false,
        "checks": checks,
      ])
  }

  @Test("encodeMergedDoctorReport reconciles net.system_proxy_alignment into 27 unique checks (B7)")
  func encodeMergedDoctorReportReconcilesDuplicateProxyCheck() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-b7-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let rings = await MainActor.run { ShellDecisionRings() }
    let baseEval = await ShellEnvironmentChecks.evaluate(
      snapshot: Self.makeSnapshot(dataDir: tempDir, homeDir: tempDir), decisionRings: rings)

    let modifiedShellChecks = baseEval.checks.map { check -> ShellDoctorCheck in
      guard check.id == "net.system_proxy_alignment" else { return check }
      return ShellDoctorCheck(
        id: check.id,
        layer: check.layer,
        status: .warn,
        reasonCode: "pac_or_wpad_fallback_to_direct",
        durationMs: 12,
        metrics: [
          .init(key: "pacEnabled", value: "true"),
          .init(key: "wpadEnabled", value: "false"),
          .init(key: "httpProxyEnabled", value: "false"),
          .init(key: "httpsProxyEnabled", value: "false"),
          .init(key: "socksProxyEnabled", value: "false"),
          .init(key: "customAdminRootCertCount", value: "1"),
        ],
        remediation: .init(
          remediationCode: "configure_supported_http_proxy",
          action: .openExternalDocs,
          settingsSection: nil, probeKind: nil, docsUrl: "https://atd.best"))
    }
    let eval = ShellEnvironmentChecks.Evaluation(
      capturedAt: baseEval.capturedAt,
      environmentRecord: baseEval.environmentRecord,
      checks: modifiedShellChecks,
      rings: baseEval.rings)

    let svcPassJSON = try Self.makeServiceDoctorJSON(
      proxyStatus: "pass", proxyReason: "ok", proxyDurationMs: 31)
    let mergedData = try #require(
      DiagnosticsExporter.encodeMergedDoctorReport(
        shellEvaluation: eval, serviceDoctorJSON: svcPassJSON, serviceReachable: true,
        unavailable: nil, lastFailure: nil))
    let root = try #require(JSONSerialization.jsonObject(with: mergedData) as? [String: Any])
    let checks = try #require(root["checks"] as? [[String: Any]])
    #expect(checks.count == 27)
    #expect(Set(checks.compactMap { $0["id"] as? String }).count == 27)

    let summary = try #require(root["summary"] as? [String: Int])
    let sumTotal =
      (summary["passCount"] ?? 0) + (summary["warnCount"] ?? 0) + (summary["failCount"] ?? 0)
      + (summary["skippedCount"] ?? 0)
    #expect(sumTotal == 27)

    let proxy = try #require(checks.first { $0["id"] as? String == "net.system_proxy_alignment" })
    #expect(proxy["status"] as? String == "warn")
    #expect(proxy["reasonCode"] as? String == "pac_or_wpad_fallback_to_direct")
    #expect((proxy["durationMs"] as? NSNumber)?.doubleValue == 31)
    #expect(proxy["remediation"] != nil)
    let proxyMetrics = try #require(proxy["metrics"] as? [[String: String]])
    let metricKeys = proxyMetrics.compactMap { $0["key"] }
    #expect(metricKeys.starts(with: ["pacEnabled", "wpadEnabled", "httpProxyEnabled"]))
    #expect(metricKeys.contains("skippedBypassCount"))
    #expect(proxyMetrics.first { $0["key"] == "httpConfigured" }?["value"] == "false")

    let shellPassChecks = baseEval.checks.map { check -> ShellDoctorCheck in
      guard check.id == "net.system_proxy_alignment" else { return check }
      return ShellDoctorCheck(
        id: check.id, layer: check.layer, status: .pass, reasonCode: "ok", durationMs: 8,
        metrics: [.init(key: "pacEnabled", value: "false")], remediation: nil)
    }
    let evalPass = ShellEnvironmentChecks.Evaluation(
      capturedAt: baseEval.capturedAt, environmentRecord: baseEval.environmentRecord,
      checks: shellPassChecks, rings: baseEval.rings)
    let svcWarnJSON = try Self.makeServiceDoctorJSON(
      proxyStatus: "warn", proxyReason: "glob_bypass_rules_skipped", proxyDurationMs: 19,
      proxyRemediation: ["remediationCode": "configure_supported_http_proxy", "action": "none"])
    let mergedWarnData = try #require(
      DiagnosticsExporter.encodeMergedDoctorReport(
        shellEvaluation: evalPass, serviceDoctorJSON: svcWarnJSON, serviceReachable: true,
        unavailable: nil, lastFailure: nil))
    let warnRoot = try #require(
      JSONSerialization.jsonObject(with: mergedWarnData) as? [String: Any])
    let warnChecks = try #require(warnRoot["checks"] as? [[String: Any]])
    let warnProxy = try #require(
      warnChecks.first { $0["id"] as? String == "net.system_proxy_alignment" })
    #expect(warnProxy["status"] as? String == "warn")
    #expect(warnProxy["reasonCode"] as? String == "glob_bypass_rules_skipped")
  }

  @Test("DiagnosticsExporter waits up to 2.5s for 1.5s service Doctor runs without truncating (B8)")
  func exporterRetainsSlowServiceDoctorChecksWithinBudget() async throws {
    let tempDir = FileManager.default.temporaryDirectory
      .appending(path: "atd-b8-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: tempDir) }

    let doctorBody = try Self.makeServiceDoctorJSON()
    let server = try DelayedDoctorLoopbackServer(doctorDelayMs: 1_450, doctorBody: doctorBody)
    defer { server.stop() }

    let token = String(repeating: "t", count: 40)
    let endpointJSON = try JSONSerialization.data(
      withJSONObject: [
        "version": 1, "serviceId": "svc-b8", "protocolVersion": "1", "epoch": 1,
        "host": "127.0.0.1", "port": Int(server.port), "url": "http://127.0.0.1:\(server.port)",
        "pid": Int(getpid()), "startedAt": "2026-11-18T12:00:00.000Z",
      ])
    let tokenJSON = try JSONSerialization.data(
      withJSONObject: [
        "version": 1, "serviceId": "svc-b8", "token": token,
        "createdAt": "2026-11-18T12:00:00.000Z",
      ])
    let endpoint = try ServiceEndpointFiles.parse(
      endpoint: endpointJSON, token: tokenJSON, dataDirectory: tempDir)

    let shellLog = ShellLogWriter(logFileURL: tempDir.appending(path: "logs/shell.jsonl"))
    defer { shellLog.close() }
    let rings = await MainActor.run { ShellDecisionRings() }
    let req = DiagnosticsExporter.ExportRequest(
      triggerSurface: .settings, includeCrashSummaries: false,
      rendererBreadcrumbs: RendererBreadcrumbsPayload(
        capturedAt: "2026-11-18T12:00:00.000Z", droppedCount: 0, entries: []),
      mainActorSnapshot: Self.makeSnapshot(dataDir: tempDir, homeDir: tempDir, endpoint: endpoint),
      decisionRings: rings, shellLog: shellLog, serviceLogDirectoryURL: nil,
      dataDirectoryURL: tempDir, crashReportsDirectoryURL: nil, recentServiceExits: [],
      serviceEndpoint: endpoint, serviceUnavailable: nil, lastFailureSummary: nil)

    let zipURL = tempDir.appending(path: "out.zip")
    _ = try await DiagnosticsExporter.exportZip(request: req, destinationZipURL: zipURL)
    let unpack = tempDir.appending(path: "unpack", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: unpack, withIntermediateDirectories: true)
    let ditto = Process()
    ditto.executableURL = URL(filePath: "/usr/bin/ditto")
    ditto.arguments = ["-x", "-k", zipURL.path(percentEncoded: false), unpack.path()]
    try ditto.run()
    ditto.waitUntilExit()
    let bundleRoot = try #require(
      FileManager.default.contentsOfDirectory(at: unpack, includingPropertiesForKeys: nil).first)
    let reportData = try Data(contentsOf: bundleRoot.appending(path: "doctor-report.json"))
    let report = try #require(JSONSerialization.jsonObject(with: reportData) as? [String: Any])
    let checks = try #require(report["checks"] as? [[String: Any]])
    #expect(report["serviceReachable"] as? Bool == true)
    #expect(checks.count == 27)
  }
}
