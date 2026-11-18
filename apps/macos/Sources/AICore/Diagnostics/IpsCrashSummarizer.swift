import Foundation

/// Recent child `node` process exit record retained by `ServiceSupervisor` (`<= 10` entries).
public struct ServiceProcessExitRecord: Codable, Equatable, Sendable {
  public let recordedAt: String
  public let terminationStatus: Int32
  public let uncaughtSignal: Bool
  public let summary: String

  public init(
    recordedAt: String,
    terminationStatus: Int32,
    uncaughtSignal: Bool,
    summary: String
  ) {
    self.recordedAt = recordedAt
    self.terminationStatus = terminationStatus
    self.uncaughtSignal = uncaughtSignal
    self.summary = summary
  }
}

/// Strictly opt-in macOS `.ips` v2 crash report summarizer (`crashes/summary.json`, `04` §1.3 (5)).
///
/// - When `optedIn == false`, returns `.notOptedIn` immediately without opening, statting, or
///   enumerating `~/Library/Logs/DiagnosticReports`.
/// - When `optedIn == true`, inspects up to 5 recent (<= 7 days) `.ips` files matching
///   `^(Atd|atd-computer-driver)[-_.]`, resolves frame module names via
///   `usedImages[frame.imageIndex].name` against ``allowedImageNames``, NEVER copies
///   `usedImages[].path`, `asi`, `threadState`, args, or env, and scrubs the resulting JSON via
///   ``DiagnosticsScrubber``.
public nonisolated enum IpsCrashSummarizer {
  public static let maxReports = 5
  public static let maxReportAgeSeconds: TimeInterval = 7 * 86_400
  public static let maxInputReportBytes = 524_288  // 512 KiB
  public static let maxOutputBytes = 262_144  // 256 KiB

  /// Exact runtime Mach-O binary/module image allowlist (`AIMac` is a SwiftPM package name, not a
  /// Mach-O image, so it is intentionally excluded).
  public static let allowedImageNames: Set<String> = [
    "Atd",
    "atd-computer-driver",
    "AICore",
    "AIRelay",
    "AIShell",
    "AIComputerDriver",
    "AIWidgetModel",
    "AIWidgetRender",
  ]

  public struct CrashFrameSummary: Codable, Equatable, Sendable {
    public let frameIndex: Int
    public let imageName: String
    public let imageOffset: Int
    public let symbolLocation: Int?

    public init(frameIndex: Int, imageName: String, imageOffset: Int, symbolLocation: Int?) {
      self.frameIndex = frameIndex
      self.imageName = imageName
      self.imageOffset = imageOffset
      self.symbolLocation = symbolLocation
    }
  }

  public struct IpsReportSummary: Codable, Equatable, Sendable {
    public let processName: String
    public let captureTime: String
    public let bugType: String?
    public let exceptionType: String?
    public let signal: String?
    public let terminationNamespace: String?
    public let terminationCode: Int64?
    public let faultingThread: Int?
    public let appFrames: [CrashFrameSummary]

    public init(
      processName: String,
      captureTime: String,
      bugType: String?,
      exceptionType: String?,
      signal: String?,
      terminationNamespace: String?,
      terminationCode: Int64?,
      faultingThread: Int?,
      appFrames: [CrashFrameSummary]
    ) {
      self.processName = processName
      self.captureTime = captureTime
      self.bugType = bugType
      self.exceptionType = exceptionType
      self.signal = signal
      self.terminationNamespace = terminationNamespace
      self.terminationCode = terminationCode
      self.faultingThread = faultingThread
      self.appFrames = appFrames
    }
  }

  public struct SummaryDocument: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let generatedAt: String
    public let crashReports: [IpsReportSummary]
    public let recentServiceExits: [ServiceProcessExitRecord]

    public init(
      schemaVersion: Int = 1,
      generatedAt: String,
      crashReports: [IpsReportSummary],
      recentServiceExits: [ServiceProcessExitRecord]
    ) {
      self.schemaVersion = schemaVersion
      self.generatedAt = generatedAt
      self.crashReports = crashReports
      self.recentServiceExits = recentServiceExits
    }
  }

  public enum Outcome: Equatable, Sendable {
    case notOptedIn
    case scrubbed(DiagnosticsScrubber.ScrubbedFileOutcome)
  }

  public static func defaultReportsDirectory(
    homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> URL {
    homeDirectory.appending(path: "Library/Logs/DiagnosticReports", directoryHint: .isDirectory)
  }

  public static func summarize(
    optedIn: Bool,
    reportsDirectory: URL? = nil,
    recentServiceExits: [ServiceProcessExitRecord] = [],
    now: Date = Date(),
    anchors: DiagnosticsScrubber.EnvironmentAnchors = .current
  ) -> Outcome {
    guard optedIn else { return .notOptedIn }
    let dir = reportsDirectory ?? defaultReportsDirectory()
    let reports = collectRecentReports(in: dir, now: now)
    let isoNow = now.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true))
    let trimmedExits = Array(recentServiceExits.suffix(10))
    let document = SummaryDocument(
      generatedAt: isoNow,
      crashReports: reports,
      recentServiceExits: trimmedExits)

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let rawJson = try? encoder.encode(document), rawJson.count <= maxOutputBytes else {
      return .scrubbed(
        .omitted(status: .omittedSizeCap, errorCode: .stagingCapExceeded, durationMs: 0))
    }
    let scrubbed = DiagnosticsScrubber.scrubFile(
      path: "crashes/summary.json",
      rawBytes: rawJson,
      kind: .json,
      anchors: anchors)
    return .scrubbed(scrubbed)
  }

  /// Parses one raw `.ips` v2 payload (first line JSON header + second JSON body) in memory.
  public static func parseIpsV2(_ rawData: Data) -> IpsReportSummary? {
    let capped =
      rawData.count > maxInputReportBytes ? rawData.prefix(maxInputReportBytes) : rawData[...]
    guard let newlineIndex = capped.firstIndex(of: 0x0A) else { return nil }
    let headerSlice = capped[..<newlineIndex]
    let bodyStart = capped.index(after: newlineIndex)
    guard bodyStart < capped.endIndex else { return nil }
    let bodySlice = capped[bodyStart...]

    guard
      let header = (try? JSONSerialization.jsonObject(with: Data(headerSlice))) as? [String: Any],
      let body = (try? JSONSerialization.jsonObject(with: Data(bodySlice))) as? [String: Any]
    else { return nil }

    let rawProc =
      (body["procName"] as? String) ?? (header["app_name"] as? String)
      ?? (header["name"] as? String) ?? "unknown"
    guard rawProc == "Atd" || rawProc == "atd-computer-driver" else { return nil }

    let captureTime = (body["captureTime"] as? String) ?? (header["timestamp"] as? String) ?? ""
    let bugType = header["bug_type"] as? String
    let exception = body["exception"] as? [String: Any]
    let exceptionType = exception?["type"] as? String
    let signal = exception?["signal"] as? String
    let termination = body["termination"] as? [String: Any]
    let termNamespace = termination?["namespace"] as? String
    let termCode = (termination?["code"] as? NSNumber)?.int64Value
    let faultingThread = body["faultingThread"] as? Int

    // Extract ONLY `name` from `usedImages` (NEVER touch `usedImages[].path`!).
    let usedImages = (body["usedImages"] as? [[String: Any]]) ?? []
    let imageNames: [String?] = usedImages.map { $0["name"] as? String }

    var appFrames: [CrashFrameSummary] = []
    if let threads = body["threads"] as? [[String: Any]],
      let threadIdx = faultingThread,
      threadIdx >= 0 && threadIdx < threads.count,
      let frames = threads[threadIdx]["frames"] as? [[String: Any]]
    {
      for (frameIdx, frame) in frames.prefix(64).enumerated() {
        guard let imageIndex = frame["imageIndex"] as? Int,
          imageIndex >= 0 && imageIndex < imageNames.count,
          let imageName = imageNames[imageIndex],
          allowedImageNames.contains(imageName),
          let imageOffset = (frame["imageOffset"] as? NSNumber)?.intValue
        else { continue }
        let symbolLoc = (frame["symbolLocation"] as? NSNumber)?.intValue
        appFrames.append(
          CrashFrameSummary(
            frameIndex: frameIdx,
            imageName: imageName,
            imageOffset: imageOffset,
            symbolLocation: symbolLoc))
      }
    }

    return IpsReportSummary(
      processName: rawProc,
      captureTime: captureTime,
      bugType: bugType,
      exceptionType: exceptionType,
      signal: signal,
      terminationNamespace: termNamespace,
      terminationCode: termCode,
      faultingThread: faultingThread,
      appFrames: appFrames)
  }

  private static func collectRecentReports(in directory: URL, now: Date) -> [IpsReportSummary] {
    guard !DiagnosticsPathPolicy.isHardExcludedSource(directory) else { return [] }
    let fm = FileManager.default
    guard
      let urls = try? fm.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
        options: [.skipsHiddenFiles])
    else { return [] }

    let cutoff = now.addingTimeInterval(-maxReportAgeSeconds)
    let matching: [(url: URL, modified: Date)] = urls.compactMap { url in
      let name = url.lastPathComponent
      guard name.hasSuffix(".ips"), Self.matchesTargetFilename(name),
        let values = try? url.resourceValues(forKeys: [
          .contentModificationDateKey, .isRegularFileKey,
        ]),
        values.isRegularFile == true,
        let modified = values.contentModificationDate,
        modified >= cutoff
      else { return nil }
      return (url, modified)
    }

    let newest = matching.sorted { $0.modified > $1.modified }.prefix(maxReports)
    return newest.compactMap { candidate in
      guard let handle = try? FileHandle(forReadingFrom: candidate.url) else { return nil }
      defer { try? handle.close() }
      guard let raw = try? handle.read(upToCount: maxInputReportBytes) else { return nil }
      return parseIpsV2(raw)
    }
  }

  private static func matchesTargetFilename(_ name: String) -> Bool {
    for prefix in [
      "Atd-", "Atd_", "Atd.", "atd-computer-driver-", "atd-computer-driver_",
      "atd-computer-driver.",
    ] {
      if name.hasPrefix(prefix) { return true }
    }
    return false
  }
}
