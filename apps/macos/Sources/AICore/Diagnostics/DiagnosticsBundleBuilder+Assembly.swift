import Foundation

extension DiagnosticsBundleBuilder {
  struct AssembledBundle {
    let manifest: DiagnosticsBundleManifest
    let manifestBytes: Data
    let payloadByPath: [String: Data]
  }

  private struct CandidateSpec {
    let path: String
    let kind: DiagnosticsScrubber.ScrubKind
    let isPrimaryPriority: Bool
    let rawBytes: Data?
    let precomputedOutcome: DiagnosticsScrubber.ScrubbedFileOutcome?
    let unavailableStatus: BundleFileStatus
  }

  func validateNoExcludedSources(_ urls: [URL], dataDirectoryURL: URL? = nil) throws {
    for url in urls
    where DiagnosticsPathPolicy.isHardExcludedSource(url, dataDirectoryURL: dataDirectoryURL) {
      throw ScrubberAbortReason.scrubberException
    }
  }

  /// Explicit guard callable by exporters/tests to verify a source URL against hard-excludes.
  public static func assertAllowedSource(_ url: URL, dataDirectoryURL: URL? = nil) throws {
    if DiagnosticsPathPolicy.isHardExcludedSource(url, dataDirectoryURL: dataDirectoryURL) {
      throw ScrubberAbortReason.scrubberException
    }
  }

  func assembleScrubbedEntries(inputs: Inputs) -> AssembledBundle {
    let isoGenerated = DiagnosticsTimestamp.iso8601UTC(inputs.generatedAt)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]

    let envData = inputs.environmentRecord.flatMap { try? encoder.encode($0) }
    let selData = try? inputs.decisionRings?.exportSelectionJSON()
    let hkData = try? inputs.decisionRings?.exportHotKeysJSON()
    let capData = try? inputs.decisionRings?.exportCaptureArbiterJSON(
      heldClaims: inputs.heldArbiterClaims)
    let relData = try? inputs.decisionRings?.exportRelaySupervisorJSON()
    let runPrepData =
      inputs.runPrepRingJSON
      ?? DiagnosticsLogTailReader.extractSubobjectJSON(
        from: inputs.serviceSnapshotJSON, key: "runPrepDecisionRing")

    let snapshotOutcome: DiagnosticsScrubber.ScrubbedFileOutcome? =
      if let snap = inputs.serviceSnapshotJSON, snap.count > Self.maxServiceSnapshotBytes {
        .omitted(status: .omittedSizeCap, errorCode: .stagingCapExceeded, durationMs: 0)
      } else {
        nil
      }

    let crashOutcome = IpsCrashSummarizer.summarize(
      optedIn: inputs.includeCrashSummaries,
      reportsDirectory: inputs.crashReportsDirectoryURL,
      recentServiceExits: inputs.recentServiceExits,
      now: inputs.generatedAt,
      anchors: inputs.anchors,
      dataDirectoryURL: inputs.dataDirectoryURL)

    let shellTail = DiagnosticsLogTailReader.collectShellTail(
      shellLogURL: inputs.shellLogFileURL, dataDirectoryURL: inputs.dataDirectoryURL)
    let serviceTail = DiagnosticsLogTailReader.collectServiceTail(
      logDir: inputs.serviceLogDirectoryURL,
      ringLines: inputs.serviceLogRingLines,
      snapshotJSON: inputs.serviceSnapshotJSON,
      dataDirectoryURL: inputs.dataDirectoryURL)
    let driverTail = DiagnosticsLogTailReader.collectComputerDriverTail(
      dataDir: inputs.dataDirectoryURL)
    let browserTail = DiagnosticsLogTailReader.collectBrowserWorkersTail(
      dataDir: inputs.dataDirectoryURL)

    var specs: [CandidateSpec] = [
      CandidateSpec(
        path: "doctor-report.json", kind: .json, isPrimaryPriority: true,
        rawBytes: inputs.doctorReportJSON, precomputedOutcome: nil,
        unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "environment.json", kind: .json, isPrimaryPriority: true,
        rawBytes: envData, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "service-snapshot.json", kind: .json, isPrimaryPriority: true,
        rawBytes: snapshotOutcome == nil ? inputs.serviceSnapshotJSON : nil,
        precomputedOutcome: snapshotOutcome, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "decision-rings/selection.json", kind: .json, isPrimaryPriority: true,
        rawBytes: selData, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "decision-rings/hotkeys.json", kind: .json, isPrimaryPriority: true,
        rawBytes: hkData, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "decision-rings/capture-arbiter.json", kind: .json, isPrimaryPriority: true,
        rawBytes: capData, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "decision-rings/relay-supervisor.json", kind: .json, isPrimaryPriority: true,
        rawBytes: relData, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "decision-rings/run-prep.json", kind: .json, isPrimaryPriority: true,
        rawBytes: runPrepData, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "renderer-breadcrumbs.json", kind: .json, isPrimaryPriority: true,
        rawBytes: inputs.rendererBreadcrumbsJSON, precomputedOutcome: nil,
        unavailableStatus: .omittedUnavailable),
    ]

    switch crashOutcome {
    case .notOptedIn:
      specs.append(
        CandidateSpec(
          path: "crashes/summary.json", kind: .json, isPrimaryPriority: true,
          rawBytes: nil, precomputedOutcome: nil, unavailableStatus: .omittedNotOptedIn))
    case .scrubbed(let outcome):
      specs.append(
        CandidateSpec(
          path: "crashes/summary.json", kind: .json, isPrimaryPriority: true,
          rawBytes: nil, precomputedOutcome: outcome, unavailableStatus: .omittedUnavailable))
    }

    specs.append(contentsOf: [
      CandidateSpec(
        path: "logs/shell.tail.jsonl", kind: .jsonl, isPrimaryPriority: false,
        rawBytes: shellTail, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "logs/service.tail.jsonl", kind: .jsonl, isPrimaryPriority: false,
        rawBytes: serviceTail, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "logs/computer-driver.tail.log", kind: .plainText, isPrimaryPriority: false,
        rawBytes: driverTail, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
      CandidateSpec(
        path: "logs/browser-workers.tail.log", kind: .plainText, isPrimaryPriority: false,
        rawBytes: browserTail, precomputedOutcome: nil, unavailableStatus: .omittedUnavailable),
    ])

    return evaluateSpecs(specs, inputs: inputs, isoGenerated: isoGenerated, encoder: encoder)
  }

  static func makeExcerpt(
    from data: Data, remainingBudget: inout Int
  ) -> (excerpt: String?, truncated: Bool) {
    guard !data.isEmpty else { return ("", false) }
    guard remainingBudget > 0 else { return (nil, true) }
    let allowed = min(maxPreviewFileBytes, remainingBudget)
    let wasCapped = data.count > allowed
    let prefixSlice = data.prefix(allowed)
    var cut = prefixSlice.count
    if wasCapped {
      while cut > 0 && (prefixSlice[prefixSlice.startIndex + cut - 1] & 0xC0) == 0x80 {
        cut -= 1
      }
      if cut > 0 && prefixSlice[prefixSlice.startIndex + cut - 1] >= 0xC0 {
        cut -= 1
      }
    }
    var decoded = String(decoding: prefixSlice.prefix(cut), as: UTF8.self)
    if decoded.utf16.count > maxPreviewFileBytes {
      decoded = String(decoded.prefix(maxPreviewFileBytes))
    }
    remainingBudget = max(0, remainingBudget - decoded.utf8.count)
    return (decoded, wasCapped || cut < data.count)
  }

  private func evaluateSpecs(
    _ specs: [CandidateSpec], inputs: Inputs, isoGenerated: String, encoder: JSONEncoder
  ) -> AssembledBundle {
    let contentCap = Self.maxStagingBytes - Self.maxManifestReserveBytes
    var usedBytes = 0
    var payloadByPath: [String: Data] = [:]
    var resolvedByIndex: [Int: DiagnosticsBundleManifest.FileEntry] = [:]
    let orderedIndices =
      specs.indices.filter { specs[$0].isPrimaryPriority }
      + specs.indices.filter { !specs[$0].isPrimaryPriority }

    for idx in orderedIndices {
      let spec = specs[idx]
      guard DiagnosticsPathPolicy.isAllowedArchiveEntry(spec.path) else { continue }
      let outcome: DiagnosticsScrubber.ScrubbedFileOutcome
      if let pre = spec.precomputedOutcome {
        outcome = pre
      } else if let raw = spec.rawBytes {
        outcome = DiagnosticsScrubber.scrubFile(
          path: spec.path, rawBytes: raw, kind: spec.kind,
          anchors: inputs.anchors, budget: inputs.perFileBudget)
      } else {
        resolvedByIndex[idx] = .init(
          path: spec.path, status: spec.unavailableStatus, byteSize: 0,
          sha256: nil, redactionHits: 0, scrubDurationMs: 0, errorCode: nil)
        continue
      }

      switch outcome {
      case .included(let bytes, let sha, let hits, let ms):
        if usedBytes + bytes.count <= contentCap {
          usedBytes += bytes.count
          payloadByPath[spec.path] = bytes
          resolvedByIndex[idx] = .init(
            path: spec.path, status: .included, byteSize: bytes.count,
            sha256: sha, redactionHits: hits, scrubDurationMs: ms, errorCode: nil)
        } else {
          resolvedByIndex[idx] = .init(
            path: spec.path, status: .omittedSizeCap, byteSize: 0,
            sha256: nil, redactionHits: 0, scrubDurationMs: ms, errorCode: .stagingCapExceeded)
        }
      case .omitted(let status, let code, let ms):
        resolvedByIndex[idx] = .init(
          path: spec.path, status: status, byteSize: 0,
          sha256: nil, redactionHits: 0, scrubDurationMs: ms, errorCode: code)
      }
    }

    let fileEntries = specs.indices.compactMap { resolvedByIndex[$0] }
    let includedCount = fileEntries.filter { $0.status == .included }.count
    let omittedCount = fileEntries.count - includedCount
    let totalHits = fileEntries.reduce(0) { $0 + $1.redactionHits }
    let budgetMs = max(
      1,
      Int(
        Double(inputs.perFileBudget.components.seconds) * 1_000.0
          + Double(inputs.perFileBudget.components.attoseconds) / 1_000_000_000_000_000.0))

    func buildManifest(uncompressed: Int) -> DiagnosticsBundleManifest {
      DiagnosticsBundleManifest(
        generatedAt: isoGenerated,
        triggerSurface: inputs.triggerSurface,
        isDevelopment: inputs.isDevelopment,
        consent: .init(includeCrashSummaries: inputs.includeCrashSummaries),
        budgets: .init(perFileCpuBudgetMs: budgetMs),
        totals: .init(
          uncompressedBytes: uncompressed,
          includedFiles: includedCount + 1,
          omittedFiles: omittedCount,
          redactionReplacements: totalHits),
        files: fileEntries)
    }

    let provBytes = (try? encoder.encode(buildManifest(uncompressed: usedBytes))) ?? Data("{}".utf8)
    let finalManifest = buildManifest(
      uncompressed: min(Self.maxStagingBytes, usedBytes + provBytes.count))
    let finalBytes = (try? encoder.encode(finalManifest)) ?? provBytes
    return AssembledBundle(
      manifest: finalManifest, manifestBytes: finalBytes, payloadByPath: payloadByPath)
  }
}
