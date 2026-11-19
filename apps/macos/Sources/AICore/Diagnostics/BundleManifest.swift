import Foundation

/// Inclusion or omission status recorded per file in `manifest.json` and `diagnostics.previewBundle`.
public enum BundleFileStatus: String, Codable, Equatable, Sendable {
  case included
  case omittedRedactionError = "omitted_redaction_error"
  case omittedNotOptedIn = "omitted_not_opted_in"
  case omittedUnavailable = "omitted_unavailable"
  case omittedSizeCap = "omitted_size_cap"
}

/// Machine error code explaining why a candidate bundle file was dropped fail-closed.
public enum ScrubberAbortReason: String, Error, Codable, Equatable, Sendable {
  case cpuBudgetExceeded = "cpu_budget_exceeded"
  case utf8OrJsonInvalid = "utf8_or_json_invalid"
  case scrubberException = "scrubber_exception"
  case stagingCapExceeded = "staging_cap_exceeded"
}

/// Entry-point surface that initiated bundle creation.
public enum DiagnosticsTriggerSurface: String, Codable, Equatable, Sendable {
  case settings
  case menu
  case recoveryCard = "recovery_card"
}

/// Machine-verifiable `manifest.json` root structure (`atd-diagnostics-v1`).
public struct DiagnosticsBundleManifest: Codable, Equatable, Sendable {
  public struct Consent: Codable, Equatable, Sendable {
    public let includeCrashSummaries: Bool

    public init(includeCrashSummaries: Bool) {
      self.includeCrashSummaries = includeCrashSummaries
    }
  }

  public struct Budgets: Codable, Equatable, Sendable {
    public let maxStagingBytes: Int
    public let maxLineBytes: Int
    public let perFileCpuBudgetMs: Int

    public init(
      maxStagingBytes: Int = 8_388_608,
      maxLineBytes: Int = 4_096,
      perFileCpuBudgetMs: Int = 250
    ) {
      self.maxStagingBytes = maxStagingBytes
      self.maxLineBytes = maxLineBytes
      self.perFileCpuBudgetMs = perFileCpuBudgetMs
    }
  }

  public struct Totals: Codable, Equatable, Sendable {
    public let uncompressedBytes: Int
    public let includedFiles: Int
    public let omittedFiles: Int
    public let redactionReplacements: Int

    public init(
      uncompressedBytes: Int, includedFiles: Int, omittedFiles: Int, redactionReplacements: Int
    ) {
      self.uncompressedBytes = uncompressedBytes
      self.includedFiles = includedFiles
      self.omittedFiles = omittedFiles
      self.redactionReplacements = redactionReplacements
    }
  }

  public struct FileEntry: Codable, Equatable, Sendable {
    public let path: String
    public let status: BundleFileStatus
    public let byteSize: Int
    public let sha256: String?
    public let redactionHits: Int
    public let scrubDurationMs: Int
    public let errorCode: ScrubberAbortReason?

    public init(
      path: String,
      status: BundleFileStatus,
      byteSize: Int,
      sha256: String?,
      redactionHits: Int,
      scrubDurationMs: Int,
      errorCode: ScrubberAbortReason?
    ) {
      self.path = path
      self.status = status
      self.byteSize = byteSize
      self.sha256 = sha256
      self.redactionHits = redactionHits
      self.scrubDurationMs = scrubDurationMs
      self.errorCode = errorCode
    }
  }

  public let schemaVersion: Int
  public let bundleFormat: String
  public let generatedAt: String
  public let triggerSurface: DiagnosticsTriggerSurface
  public let isDevelopment: Bool
  public let consent: Consent
  public let budgets: Budgets
  public let totals: Totals
  public let files: [FileEntry]

  public init(
    schemaVersion: Int = 1,
    bundleFormat: String = "atd-diagnostics-v1",
    generatedAt: String,
    triggerSurface: DiagnosticsTriggerSurface,
    isDevelopment: Bool,
    consent: Consent,
    budgets: Budgets = Budgets(),
    totals: Totals,
    files: [FileEntry]
  ) {
    self.schemaVersion = schemaVersion
    self.bundleFormat = bundleFormat
    self.generatedAt = generatedAt
    self.triggerSurface = triggerSurface
    self.isDevelopment = isDevelopment
    self.consent = consent
    self.budgets = budgets
    self.totals = totals
    self.files = files
  }
}

/// Allowlist-first archive entry validation and anchored hard-exclusion enforcement (`04` §2, `B15`).
public nonisolated enum DiagnosticsPathPolicy {
  /// Exact archive relative paths permitted inside `atd-diagnostics-*.zip`.
  public static let allowedArchiveEntries: Set<String> = [
    "manifest.json",
    "doctor-report.json",
    "environment.json",
    "service-snapshot.json",
    "decision-rings/selection.json",
    "decision-rings/hotkeys.json",
    "decision-rings/capture-arbiter.json",
    "decision-rings/relay-supervisor.json",
    "decision-rings/run-prep.json",
    "renderer-breadcrumbs.json",
    "logs/shell.tail.jsonl",
    "logs/service.tail.jsonl",
    "logs/computer-driver.tail.log",
    "logs/browser-workers.tail.log",
    "crashes/summary.json",
  ]

  private static let privateDataSubdirs: Set<String> = [
    "memory", "resources", "extractions", "tasks", "atd",
  ]

  public static func isAllowedArchiveEntry(_ relativePath: String) -> Bool {
    guard !relativePath.isEmpty,
      !relativePath.hasPrefix("/"),
      !relativePath.contains(".."),
      !relativePath.contains("\\")
    else { return false }
    return allowedArchiveEntries.contains(relativePath)
  }

  /// Rejects sensitive local stores, credentials, transcripts, memory SQLite files, personal
  /// skills, local secret configs, and Folder-TCC protected directories (`04` §2).
  public static func isHardExcludedSource(_ url: URL, dataDirectoryURL: URL? = nil) -> Bool {
    let raw = url.standardizedFileURL.path(percentEncoded: false)
    let dataDirPath = dataDirectoryURL?.standardizedFileURL.path(percentEncoded: false)
    return isHardExcludedPathString(raw, dataDirectoryPath: dataDirPath)
  }

  public static func isHardExcludedPathString(
    _ rawPath: String,
    dataDirectoryPath: String? = nil,
    homeDirectoryPath: String? = FileManager.default.homeDirectoryForCurrentUser.path(
      percentEncoded: false)
  ) -> Bool {
    let lowered = normalizeLowerPath(rawPath)
    let segments = lowered.split(separator: "/").map(String.init)
    let fileName = segments.last ?? ""

    if fileName == "ledger.json" || fileName.hasPrefix("ledger.json.") { return true }
    if fileName == "wrangler.local.jsonc" { return true }
    if fileName == ".env" || fileName.hasPrefix(".env.") { return true }
    if fileName == ".dev.vars" || fileName.hasPrefix(".dev.vars.") { return true }
    if fileName == "index.db" || fileName.hasPrefix("index.db-") { return true }
    if segments.contains(".atd") || segments.contains(".local") { return true }

    let nonUserStart = userHomeRelativeIndex(in: segments)
    if segments.count >= 2 && segments[segments.count - 2] == "auth" && fileName == "token" {
      return true
    }
    if fileName.hasSuffix(".jsonl") && segments.dropFirst(nonUserStart).dropLast().contains("audit")
    {
      return true
    }

    if segments.count >= nonUserStart + 2 {
      for idx in nonUserStart..<(segments.count - 1) {
        let current = segments[idx]
        let next = segments[idx + 1]
        if current == "agent" && (next == "sessions" || next == "memory") {
          return true
        }
        if isAgentServiceDirectory(current) && privateDataSubdirs.contains(next) {
          return true
        }
      }
    }

    if let dataDirectoryPath {
      let dataLower = normalizeLowerPath(dataDirectoryPath)
      if !dataLower.isEmpty && dataLower != "/" {
        for sub in privateDataSubdirs {
          let candidate = "\(dataLower)/\(sub)"
          if lowered == candidate || lowered.hasPrefix(candidate + "/") { return true }
        }
      }
    }

    // Folder-TCC protected user home directories: anchor to `/Users/<username>/...` (and firmlinks)
    // plus `homeDirectoryPath` so a user named `documents` or `desktop` is never misclassified.
    if nonUserStart > 0 && segments.count > nonUserStart {
      let top = segments[nonUserStart]
      if top == "desktop" || top == "documents" || top == "downloads" { return true }
      if top == "library" && segments.count > nonUserStart + 1
        && segments[nonUserStart + 1] == "mobile documents"
      {
        return true
      }
    }
    if let homeDirectoryPath {
      let homeLower = normalizeLowerPath(homeDirectoryPath)
      if !homeLower.isEmpty && homeLower != "/" {
        for suffix in ["/desktop", "/documents", "/downloads", "/library/mobile documents"] {
          let protectedRoot = homeLower + suffix
          if lowered == protectedRoot || lowered.hasPrefix(protectedRoot + "/") { return true }
        }
      }
    }
    return false
  }

  private static func normalizeLowerPath(_ path: String) -> String {
    let forward = path.replacingOccurrences(of: "\\", with: "/")
    let trimmed =
      forward.count > 1 && forward.hasSuffix("/") ? String(forward.dropLast()) : forward
    return trimmed.lowercased()
  }

  private static func userHomeRelativeIndex(in segments: [String]) -> Int {
    if segments.count >= 2 && (segments[0] == "users" || segments[0] == "home") {
      return 2
    }
    if segments.count >= 3 && segments[0] == "private" && segments[1] == "var"
      && segments[2] == "root"
    {
      return 3
    }
    if segments.count >= 5 && segments[0] == "system" && segments[1] == "volumes"
      && segments[2] == "data" && (segments[3] == "users" || segments[3] == "home")
    {
      return 5
    }
    return 0
  }

  private static func isAgentServiceDirectory(_ segment: String) -> Bool {
    segment == "agentservice"
      || segment.hasPrefix("agentservice ")
      || segment.hasPrefix("agentservice-")
      || segment.hasPrefix("agentservice_")
  }
}
