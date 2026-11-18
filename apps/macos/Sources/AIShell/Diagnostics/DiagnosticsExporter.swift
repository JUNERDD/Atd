import AICore
import AIRelay
import Foundation

/// Off-main diagnostics preview and `.zip` archive coordinator (`01` §8 & `04` §1.1).
///
/// Explicitly `nonisolated` with `@concurrent` entry points so `AIShell`'s default `@MainActor`
/// isolation never runs `ShellClient` snapshot fetches, 5-pass `DiagnosticsScrubber` pipelines, or
/// `/usr/bin/ditto` archiving on `CFRunLoopGetMain()`.
nonisolated enum DiagnosticsExporter {
  struct ExportRequest: Sendable {
    var triggerSurface: DiagnosticsTriggerSurface
    var includeCrashSummaries: Bool
    var rendererBreadcrumbs: RendererBreadcrumbsPayload
    var mainActorSnapshot: ShellEnvironmentChecks.MainActorSnapshot
    var decisionRings: ShellDecisionRings
    var shellLog: ShellLogWriter
    var serviceLogDirectoryURL: URL?
    var dataDirectoryURL: URL
    var crashReportsDirectoryURL: URL?
    var recentServiceExits: [ServiceProcessExitRecord]
    var serviceEndpoint: ServiceEndpoint?
    var serviceUnavailable: ServiceUnavailable?
    var lastFailureSummary: String?
    var generatedAt: Date = Date()
  }

  private struct ServiceArtifacts: Sendable {
    var snapshotJSON: Data?
    var doctorJSON: Data?
    var reachable = false
  }

  private enum BundleStageResult: Sendable {
    case shell(ShellEnvironmentChecks.Evaluation)
    case service(ServiceArtifacts)
  }

  private enum EndpointFetchPiece: Sendable {
    case snapshot(Data?)
    case doctor(Data?)
  }

  /// Zero-disk-write in-memory preview (`<= 128 KiB` total excerpts, `<= 16 KiB` per file).
  @concurrent
  static func preview(request: ExportRequest) async throws -> DiagnosticsPreviewBundleResult {
    let inputs = await buildBundleInputs(for: request)
    let result = try DiagnosticsBundleBuilder().preview(inputs: inputs)
    let files = result.files.prefix(32).map { item in
      BundlePreviewFile(
        path: item.path,
        status: mapFileStatus(item.status),
        byteSize: min(8_388_608, max(0, item.byteSize)),
        redactionHits: max(0, item.redactionHits),
        previewExcerpt: item.previewExcerpt,
        excerptTruncated: item.excerptTruncated)
    }
    return DiagnosticsPreviewBundleResult(
      generatedAt: result.generatedAt,
      suggestedFileName: result.suggestedFileName,
      totalUncompressedBytes: min(8_388_608, max(0, result.totalUncompressedBytes)),
      totalRedactionHits: max(0, result.totalRedactionHits),
      omittedFileCount: max(0, result.omittedFileCount),
      files: Array(files))
  }

  /// Streams scrubbed `64 KiB` chunks into a `0o700` staging directory and compresses via
  /// `/usr/bin/ditto -c -k --norsrc --noextattr --keepParent` (`<= 8 MiB`, `< 3s` total).
  @concurrent
  static func exportZip(
    request: ExportRequest,
    destinationZipURL: URL
  ) async throws -> DiagnosticsBundleBuilder.ArchiveResult {
    let inputs = await buildBundleInputs(for: request)
    return try DiagnosticsBundleBuilder().buildZipArchive(
      inputs: inputs,
      destinationZipURL: destinationZipURL)
  }

  @concurrent
  private static func buildBundleInputs(for request: ExportRequest) async
    -> DiagnosticsBundleBuilder.Inputs
  {
    _ = request.shellLog.flush(timeout: .milliseconds(300))

    let (eval, svc) = await withTaskGroup(of: BundleStageResult.self) { group in
      group.addTask {
        let evaluation = await ShellEnvironmentChecks.evaluate(
          snapshot: request.mainActorSnapshot,
          decisionRings: request.decisionRings,
          now: request.generatedAt)
        return .shell(evaluation)
      }
      group.addTask {
        let artifacts = await fetchServiceArtifacts(endpoint: request.serviceEndpoint)
        return .service(artifacts)
      }
      var shellResult: ShellEnvironmentChecks.Evaluation?
      var serviceResult = ServiceArtifacts()
      for await piece in group {
        switch piece {
        case .shell(let s): shellResult = s
        case .service(let a): serviceResult = a
        }
      }
      if let shellResult {
        return (shellResult, serviceResult)
      }
      let fallback = await ShellEnvironmentChecks.evaluate(
        snapshot: request.mainActorSnapshot,
        decisionRings: request.decisionRings,
        now: request.generatedAt)
      return (fallback, serviceResult)
    }

    let doctorJSON = encodeMergedDoctorReport(
      shellEvaluation: eval,
      serviceArtifacts: svc,
      unavailable: request.serviceUnavailable,
      lastFailure: request.lastFailureSummary)

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let breadcrumbsJSON = try? encoder.encode(request.rendererBreadcrumbs)

    // Note: `IpsCrashSummarizer` is strictly gated on `request.includeCrashSummaries == true`
    // inside `DiagnosticsBundleBuilder`; when `false`, `DiagnosticReports` is never opened.
    return DiagnosticsBundleBuilder.Inputs(
      triggerSurface: request.triggerSurface,
      isDevelopment: request.mainActorSnapshot.isDevelopment,
      includeCrashSummaries: request.includeCrashSummaries,
      generatedAt: request.generatedAt,
      doctorReportJSON: doctorJSON,
      environmentRecord: eval.environmentRecord,
      serviceSnapshotJSON: svc.snapshotJSON,
      serviceLogRingLines: [],
      runPrepRingJSON: nil,
      rendererBreadcrumbsJSON: breadcrumbsJSON,
      decisionRings: request.decisionRings,
      heldArbiterClaims: request.mainActorSnapshot.heldArbiterClaims,
      shellLogFileURL: request.shellLog.logFileURL,
      serviceLogDirectoryURL: request.serviceLogDirectoryURL,
      dataDirectoryURL: request.dataDirectoryURL,
      crashReportsDirectoryURL: request.crashReportsDirectoryURL,
      recentServiceExits: request.recentServiceExits)
  }

  @concurrent
  private static func fetchServiceArtifacts(endpoint: ServiceEndpoint?) async -> ServiceArtifacts {
    guard let endpoint else { return ServiceArtifacts() }
    let client = ShellClient(endpoint: endpoint)
    return await withTaskGroup(of: EndpointFetchPiece.self) { group in
      group.addTask {
        let snap = await Deadline.value(within: .milliseconds(1_200), fallback: nil) {
          try? await client.diagnosticsSnapshot(timeout: 1.0)
        }
        return .snapshot(snap)
      }
      group.addTask {
        let run = await Deadline.value(within: .milliseconds(1_400), fallback: nil) {
          try? await client.runDiagnostics(includeConnectivity: false, timeout: 1.2)
        }
        return .doctor(run)
      }
      var snap: Data?
      var run: Data?
      for await item in group {
        switch item {
        case .snapshot(let data): snap = data
        case .doctor(let data): run = data
        }
      }
      return ServiceArtifacts(
        snapshotJSON: snap,
        doctorJSON: run,
        reachable: snap != nil || run != nil)
    }
  }

  private static func encodeMergedDoctorReport(
    shellEvaluation: ShellEnvironmentChecks.Evaluation,
    serviceArtifacts: ServiceArtifacts,
    unavailable: ServiceUnavailable?,
    lastFailure: String?
  ) -> Data? {
    let encoder = JSONEncoder()
    guard let shellChecksData = try? encoder.encode(shellEvaluation.checks),
      let shellArray = (try? JSONSerialization.jsonObject(with: shellChecksData))
        as? [[String: Any]]
    else { return nil }

    var mergedChecks = shellArray
    if let svcData = serviceArtifacts.doctorJSON,
      let svcObj = (try? JSONSerialization.jsonObject(with: svcData)) as? [String: Any],
      let svcChecks = svcObj["checks"] as? [[String: Any]]
    {
      mergedChecks.append(contentsOf: svcChecks)
    }

    var passCount = 0
    var warnCount = 0
    var failCount = 0
    var skippedCount = 0
    for check in mergedChecks {
      switch check["status"] as? String {
      case "pass": passCount += 1
      case "warn": warnCount += 1
      case "fail": failCount += 1
      default: skippedCount += 1
      }
    }

    let descriptor = unavailable.map {
      ServiceUnavailableDescriptor.describe($0, lastFailure: lastFailure)
    }
    var root: [String: Any] = [
      "schemaVersion": 1,
      "capturedAt": shellEvaluation.capturedAt,
      "serviceReachable": serviceArtifacts.reachable,
      "summary": [
        "passCount": passCount,
        "warnCount": warnCount,
        "failCount": failCount,
        "skippedCount": skippedCount,
      ],
      "checks": mergedChecks,
    ]
    root["serviceUnavailableCode"] = descriptor?.errorCode ?? NSNull()
    root["serviceUnavailableSummary"] = descriptor?.summary ?? NSNull()
    return try? JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
  }

  private static func mapFileStatus(_ status: BundleFileStatus) -> BundlePreviewFile.Status {
    switch status {
    case .included: .included
    case .omittedRedactionError: .omittedRedactionError
    case .omittedNotOptedIn: .omittedNotOptedIn
    case .omittedUnavailable: .omittedUnavailable
    case .omittedSizeCap: .omittedSizeCap
    }
  }
}
