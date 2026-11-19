import CryptoKit
import Darwin
import Foundation

/// Pure `AICore` support-bundle orchestrator (`04-privacy-redaction-and-bundle.md` §1 & `01` §8).
///
/// - Enforces allowlist-first archive layout and hard-excludes (`auth/token`, `ledger.json`,
///   `audit/*.jsonl`, `agent/sessions/**`, `memory/**`, Folder-TCC directories).
/// - Applies exact tail caps (`shell.tail.jsonl` `512 KiB × 2`, `service.tail.jsonl`
///   `512 KiB + 256 KiB × 2` + deduplicated `BoundedLogRing`, `computer-driver.tail.log` `256 KiB`,
///   `browser-workers.tail.log` `256 KiB × 2`, `service-snapshot.json` `<= 600 KiB`).
/// - Supports both zero-disk-write in-memory preview (`<= 128 KiB` total excerpts, `<= 16 KiB` per
///   file) and `64 KiB`-chunked `0o700` staging (`<= 8 MiB` hard cap) + `/usr/bin/ditto` archiving.
public nonisolated struct DiagnosticsBundleBuilder: Sendable {
  public static let maxStagingBytes = 8_388_608  // 8 MiB
  public static let maxManifestReserveBytes = 65_536  // 64 KiB reserved for manifest.json
  public static let maxServiceSnapshotBytes = 614_400  // 600 KiB
  public static let shellTailPerFileBytes = 524_288  // 512 KiB
  public static let servicePrimaryTailBytes = 524_288  // 512 KiB
  public static let serviceRotatedTailBytes = 262_144  // 256 KiB
  public static let maxCombinedLogTailBytes = 1_048_576  // 1.0 MiB
  public static let computerDriverTailBytes = 262_144  // 256 KiB
  public static let browserWorkerTailBytes = 262_144  // 256 KiB
  public static let maxPreviewTotalBytes = 131_072  // 128 KiB
  public static let maxPreviewFileBytes = 16_384  // 16 KiB
  public static let streamChunkBytes = 65_536  // 64 KiB

  public struct Inputs: Sendable {
    public var triggerSurface: DiagnosticsTriggerSurface
    public var isDevelopment: Bool
    public var includeCrashSummaries: Bool
    public var generatedAt: Date
    public var doctorReportJSON: Data?
    public var environmentRecord: DiagnosticsEnvironmentRecord?
    public var serviceSnapshotJSON: Data?
    public var serviceLogRingLines: [String]
    public var runPrepRingJSON: Data?
    public var rendererBreadcrumbsJSON: Data?
    public var decisionRings: ShellDecisionRings?
    public var heldArbiterClaims: [String]
    public var shellLogFileURL: URL?
    public var serviceLogDirectoryURL: URL?
    public var dataDirectoryURL: URL?
    public var crashReportsDirectoryURL: URL?
    public var recentServiceExits: [ServiceProcessExitRecord]
    public var rejectedSourceURLs: [URL]
    public var anchors: DiagnosticsScrubber.EnvironmentAnchors
    public var perFileBudget: Duration

    public init(
      triggerSurface: DiagnosticsTriggerSurface = .settings,
      isDevelopment: Bool = false,
      includeCrashSummaries: Bool = false,
      generatedAt: Date = Date(),
      doctorReportJSON: Data? = nil,
      environmentRecord: DiagnosticsEnvironmentRecord? = nil,
      serviceSnapshotJSON: Data? = nil,
      serviceLogRingLines: [String] = [],
      runPrepRingJSON: Data? = nil,
      rendererBreadcrumbsJSON: Data? = nil,
      decisionRings: ShellDecisionRings? = nil,
      heldArbiterClaims: [String] = [],
      shellLogFileURL: URL? = nil,
      serviceLogDirectoryURL: URL? = nil,
      dataDirectoryURL: URL? = nil,
      crashReportsDirectoryURL: URL? = nil,
      recentServiceExits: [ServiceProcessExitRecord] = [],
      rejectedSourceURLs: [URL] = [],
      anchors: DiagnosticsScrubber.EnvironmentAnchors = .current,
      perFileBudget: Duration = .milliseconds(250)
    ) {
      self.triggerSurface = triggerSurface
      self.isDevelopment = isDevelopment
      self.includeCrashSummaries = includeCrashSummaries
      self.generatedAt = generatedAt
      self.doctorReportJSON = doctorReportJSON
      self.environmentRecord = environmentRecord
      self.serviceSnapshotJSON = serviceSnapshotJSON
      self.serviceLogRingLines = serviceLogRingLines
      self.runPrepRingJSON = runPrepRingJSON
      self.rendererBreadcrumbsJSON = rendererBreadcrumbsJSON
      self.decisionRings = decisionRings
      self.heldArbiterClaims = heldArbiterClaims
      self.shellLogFileURL = shellLogFileURL
      self.serviceLogDirectoryURL = serviceLogDirectoryURL
      self.dataDirectoryURL = dataDirectoryURL
      self.crashReportsDirectoryURL = crashReportsDirectoryURL
      self.recentServiceExits = recentServiceExits
      self.rejectedSourceURLs = rejectedSourceURLs
      self.anchors = anchors
      self.perFileBudget = perFileBudget
    }
  }

  public struct PreviewItem: Codable, Equatable, Sendable {
    public let path: String
    public let status: BundleFileStatus
    public let byteSize: Int
    public let redactionHits: Int
    public let previewExcerpt: String?
    public let excerptTruncated: Bool
  }

  public struct PreviewResult: Codable, Equatable, Sendable {
    public let generatedAt: String
    public let suggestedFileName: String
    public let totalUncompressedBytes: Int
    public let totalRedactionHits: Int
    public let omittedFileCount: Int
    public let manifest: DiagnosticsBundleManifest
    public let files: [PreviewItem]
  }

  public struct ArchiveResult: Equatable, Sendable {
    public let fileName: String
    public let archiveBytes: Int
    public let omittedFileCount: Int
    public let manifest: DiagnosticsBundleManifest
  }

  public init() {}

  /// Formats `atd-diagnostics-<YYYYMMDD>T<HHMMSS>Z.zip` in UTC without colons (`04` §1.1).
  public static func suggestedArchiveName(at date: Date = Date()) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    let stamp = String(
      format: "%04d%02d%02dT%02d%02d%02dZ",
      c.year ?? 1970, c.month ?? 1, c.day ?? 1, c.hour ?? 0, c.minute ?? 0, c.second ?? 0)
    return "atd-diagnostics-\(stamp).zip"
  }

  /// Zero-disk-write in-memory bundle assembly and 5-pass scrubbing (`diagnostics.previewBundle`).
  public func preview(inputs: Inputs) throws -> PreviewResult {
    try validateNoExcludedSources(
      inputs.rejectedSourceURLs, dataDirectoryURL: inputs.dataDirectoryURL)
    let assembled = assembleScrubbedEntries(inputs: inputs)
    var remainingPreviewBudget = Self.maxPreviewTotalBytes
    var items: [PreviewItem] = []
    items.reserveCapacity(assembled.manifest.files.count + 1)

    let manifestExcerpt = Self.makeExcerpt(
      from: assembled.manifestBytes, remainingBudget: &remainingPreviewBudget)
    items.append(
      PreviewItem(
        path: "manifest.json",
        status: .included,
        byteSize: assembled.manifestBytes.count,
        redactionHits: 0,
        previewExcerpt: manifestExcerpt.excerpt,
        excerptTruncated: manifestExcerpt.truncated))

    for entry in assembled.manifest.files {
      if entry.status == .included, let payload = assembled.payloadByPath[entry.path] {
        let excerpt = Self.makeExcerpt(from: payload, remainingBudget: &remainingPreviewBudget)
        items.append(
          PreviewItem(
            path: entry.path,
            status: .included,
            byteSize: entry.byteSize,
            redactionHits: entry.redactionHits,
            previewExcerpt: excerpt.excerpt,
            excerptTruncated: excerpt.truncated))
      } else {
        items.append(
          PreviewItem(
            path: entry.path,
            status: entry.status,
            byteSize: 0,
            redactionHits: 0,
            previewExcerpt: nil,
            excerptTruncated: false))
      }
    }

    return PreviewResult(
      generatedAt: assembled.manifest.generatedAt,
      suggestedFileName: Self.suggestedArchiveName(at: inputs.generatedAt),
      totalUncompressedBytes: assembled.manifest.totals.uncompressedBytes,
      totalRedactionHits: assembled.manifest.totals.redactionReplacements,
      omittedFileCount: assembled.manifest.totals.omittedFiles,
      manifest: assembled.manifest,
      files: items)
  }

  /// Streams scrubbed chunks (`64 KiB`) into a `0o700` temporary staging directory, compresses via
  /// `/usr/bin/ditto -c -k --norsrc --noextattr --keepParent`, atomically writes `destinationZipURL`,
  /// and unconditionally removes the staging directory in `defer`.
  public func buildZipArchive(
    inputs: Inputs,
    destinationZipURL: URL,
    temporaryParent: URL = FileManager.default.temporaryDirectory
  ) throws -> ArchiveResult {
    try validateNoExcludedSources(
      inputs.rejectedSourceURLs, dataDirectoryURL: inputs.dataDirectoryURL)
    let fm = FileManager.default
    let stagingRoot = temporaryParent.appending(
      path: "atd-diagnostics-staging-\(UUID().uuidString)", directoryHint: .isDirectory)
    try fm.createDirectory(
      at: stagingRoot, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: stagingRoot) }

    let fileName = Self.suggestedArchiveName(at: inputs.generatedAt)
    let stem = (fileName as NSString).deletingPathExtension
    let bundleRoot = stagingRoot.appending(path: stem, directoryHint: .isDirectory)
    try fm.createDirectory(
      at: bundleRoot, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])

    let assembled = assembleScrubbedEntries(inputs: inputs)
    for (relPath, data) in assembled.payloadByPath {
      guard DiagnosticsPathPolicy.isAllowedArchiveEntry(relPath) else {
        throw ScrubberAbortReason.scrubberException
      }
      try DiagnosticsLogTailReader.writeChunked64KiB(
        data, to: bundleRoot.appending(path: relPath))
    }
    try DiagnosticsLogTailReader.writeChunked64KiB(
      assembled.manifestBytes, to: bundleRoot.appending(path: "manifest.json"))

    let tempZip = stagingRoot.appending(path: fileName, directoryHint: .notDirectory)
    try DiagnosticsLogTailReader.runDittoZip(sourceDirectory: bundleRoot, outputZip: tempZip)
    let zipAttrs = try fm.attributesOfItem(atPath: tempZip.path(percentEncoded: false))
    let archiveBytes = (zipAttrs[.size] as? NSNumber)?.intValue ?? 0
    guard archiveBytes > 0 else { throw ScrubberAbortReason.scrubberException }

    try fm.createDirectory(
      at: destinationZipURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    if fm.fileExists(atPath: destinationZipURL.path(percentEncoded: false)) {
      try fm.removeItem(at: destinationZipURL)
    }
    try fm.moveItem(at: tempZip, to: destinationZipURL)
    return ArchiveResult(
      fileName: destinationZipURL.lastPathComponent,
      archiveBytes: archiveBytes,
      omittedFileCount: assembled.manifest.totals.omittedFiles,
      manifest: assembled.manifest)
  }

  /// Reads up to `maxBytes` from the end of an allowlisted log file, aligning to the first `\n`
  /// within the leading `4,096` bytes, or skipping `0..3` UTF-8 continuation bytes if no newline
  /// exists in the first `4 KiB` (`01` §8.1).
  public static func readTailSlice(
    of fileURL: URL, maxBytes: Int, dataDirectoryURL: URL? = nil
  ) -> Data? {
    guard maxBytes > 0,
      !DiagnosticsPathPolicy.isHardExcludedSource(fileURL, dataDirectoryURL: dataDirectoryURL),
      let handle = try? FileHandle(forReadingFrom: fileURL)
    else { return nil }
    defer { try? handle.close() }
    let fileSize = (try? handle.seekToEnd()) ?? 0
    guard fileSize > 0 else { return Data() }

    let soughtFromMidFile = fileSize > UInt64(maxBytes)
    let offset = soughtFromMidFile ? fileSize - UInt64(maxBytes) : 0
    try? handle.seek(toOffset: offset)
    guard let raw = try? handle.read(upToCount: maxBytes), !raw.isEmpty else { return nil }
    guard soughtFromMidFile else { return raw }

    let searchWindow = raw.prefix(min(4_096, raw.count))
    if let newlineIdx = searchWindow.firstIndex(of: 0x0A) {
      let after = raw.index(after: newlineIdx)
      return after < raw.endIndex ? Data(raw[after...]) : Data()
    }
    // Overlong newline-free dump fallback: skip up to 3 leading UTF-8 continuation bytes.
    var skip = 0
    while skip < min(3, raw.count) && (raw[raw.startIndex + skip] & 0xC0) == 0x80 {
      skip += 1
    }
    return Data(raw.dropFirst(skip))
  }
}
