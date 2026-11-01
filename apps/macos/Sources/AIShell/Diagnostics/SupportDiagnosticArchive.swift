import Darwin
import Foundation

/// Disk work stays off AppKit. Keeps two launch traces only within the same diagnostic build.
actor SupportDiagnosticArchive {
  private struct BuildIdentity: Codable, Equatable {
    let version: String
    let build: String
    let revision: String

    init?(info: [String: Any]) {
      guard let version = info["CFBundleShortVersionString"] as? String, !version.isEmpty,
        let build = info["CFBundleVersion"] as? String, !build.isEmpty,
        let revision = info["AtdDiagnosticRevision"] as? String, !revision.isEmpty
      else { return nil }
      self.version = version
      self.build = build
      self.revision = revision
    }
  }

  private struct StoredState: Codable {
    let schema: Int
    let identity: BuildIdentity
    let recording: Bool
  }

  private let directory: URL
  private let identity: BuildIdentity?
  private var preparationAttempted = false
  private var prepared = false
  private var recording = true
  private var lastSequence = 0
  private(set) var writeFailed = false
  static let byteLimit = 8 * 1024 * 1024

  init(profile: String) {
    directory = FileManager.default.homeDirectoryForCurrentUser
      .appending(path: "Library/Logs/AtdDiagnostics/\(profile)", directoryHint: .isDirectory)
    identity = BuildIdentity(info: Bundle.main.infoDictionary ?? [:])
  }

  func shouldRecordOnLaunch() -> Bool {
    if !preparationAttempted {
      // Never retry a partial rotation in this launch: it could rotate our own checkpoint.
      preparationAttempted = true
      do {
        try prepare()
        prepared = true
        writeFailed = false
      } catch { writeFailed = true }
    }
    return recording
  }

  func resume() throws {
    recording = false
    prepared = false
    preparationAttempted = true
    do {
      try prepareDirectory()
      try clearTraces()
      try writeState(recording: true)
      lastSequence = 0
      prepared = true
      recording = true
      writeFailed = false
    } catch {
      writeFailed = true
      throw error
    }
  }

  func complete() -> Bool {
    recording = false
    prepared = false
    preparationAttempted = true
    do {
      try prepareDirectory()
      // Persist stopping first: a crash or cleanup failure must not restart this build.
      try writeState(recording: false)
      try clearTraces()
      writeFailed = false
      return true
    } catch {
      writeFailed = true
      return false
    }
  }

  func checkpoint(_ data: Data, sequence: Int) {
    guard shouldRecordOnLaunch(), sequence > lastSequence else { return }
    do {
      let manager = FileManager.default
      guard prepared else { throw CocoaError(.fileWriteUnknown) }
      let current = directory.appending(path: "current.ndjson")
      try data.write(to: current, options: .atomic)
      try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: current.path)
      lastSequence = sequence
      writeFailed = false
    } catch { writeFailed = true }
  }

  private func prepare() throws {
    guard let identity else { throw CocoaError(.fileReadCorruptFile) }
    let stored = readState()
    if let stored, stored.identity == identity { recording = stored.recording }
    try prepareDirectory()
    if stored?.identity == identity {
      try FileManager.default.setAttributes(
        [.posixPermissions: 0o600], ofItemAtPath: marker.path)
      if !recording {
        try clearTraces()
        return
      }
    } else {
      // Commit active state only after old traces are gone. Interrupted cleanup is retried
      // on the next launch because its marker still belongs to the old/unknown build.
      try clearTraces()
      try writeState(recording: true)
    }
    let current = directory.appending(path: "current.ndjson")
    if let attributes = try traceAttributes("current.ndjson") {
      guard attributes[.type] as? FileAttributeType == .typeRegular else {
        throw CocoaError(.fileReadCorruptFile)
      }
      try removeTrace("previous.ndjson")
      try FileManager.default.moveItem(
        at: current, to: directory.appending(path: "previous.ndjson"))
    }
  }

  private func prepareDirectory() throws {
    guard identity != nil else { throw CocoaError(.fileReadCorruptFile) }
    let manager = FileManager.default
    try manager.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
  }

  private var marker: URL { directory.appending(path: "build-identity.json") }

  private func readState() -> StoredState? {
    let markerAttributes = try? FileManager.default.attributesOfItem(atPath: marker.path)
    let markerSize = markerAttributes?[.size] as? NSNumber
    if markerAttributes?[.type] as? FileAttributeType == .typeRegular,
      let markerSize, markerSize.intValue <= 4096,
      let data = try? Data(contentsOf: marker),
      let state = try? JSONDecoder().decode(StoredState.self, from: data), state.schema == 2
    {
      return state
    }
    return nil
  }

  private func writeState(recording: Bool) throws {
    guard let identity else { throw CocoaError(.fileReadCorruptFile) }
    let temporary = directory.appending(path: ".build-identity-\(UUID().uuidString).tmp")
    defer { try? FileManager.default.removeItem(at: temporary) }
    try JSONEncoder().encode(StoredState(schema: 2, identity: identity, recording: recording))
      .write(to: temporary, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
    // Permissions are set before the atomic commit, so a failed resume cannot persist active.
    guard rename(temporary.path, marker.path) == 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
  }

  private func clearTraces() throws {
    try removeTrace("current.ndjson")
    try removeTrace("previous.ndjson")
  }

  private func traceAttributes(_ name: String) throws -> [FileAttributeKey: Any]? {
    do {
      return try FileManager.default.attributesOfItem(atPath: directory.appending(path: name).path)
    } catch CocoaError.fileReadNoSuchFile {
      return nil
    }
  }

  private func removeTrace(_ name: String) throws {
    guard let attributes = try traceAttributes(name) else { return }
    let type = attributes[.type] as? FileAttributeType
    // Never recurse into an unexpected directory, or follow a link outside the recorder cache.
    guard type == .typeRegular || type == .typeSymbolicLink else {
      throw CocoaError(.fileWriteInvalidFileName)
    }
    try FileManager.default.removeItem(at: directory.appending(path: name))
  }

  func export(current: Data, metadata: Data, notes: String, to destination: URL) throws {
    let manager = FileManager.default
    let staging = manager.temporaryDirectory.appending(path: "Atd-diagnostics-\(UUID().uuidString)")
    try manager.createDirectory(
      at: staging, withIntermediateDirectories: false,
      attributes: [.posixPermissions: 0o700])
    defer { try? manager.removeItem(at: staging) }
    // Write only the report's files directly into its own directory. Enumerating and moving
    // staging children is unsafe: macOS may return /private/var URLs for a /var temp directory.
    let payload = staging.appending(path: "report", directoryHint: .isDirectory)
    try manager.createDirectory(at: payload, withIntermediateDirectories: false)
    try current.write(to: payload.appending(path: "current.ndjson"))
    try metadata.write(to: payload.appending(path: "manifest.json"))
    let previous = directory.appending(path: "previous.ndjson")
    if recording, prepared, !writeFailed,
      let attributes = try? traceAttributes("previous.ndjson"),
      attributes[.type] as? FileAttributeType == .typeRegular,
      let size = attributes[.size] as? NSNumber, size.intValue <= Self.byteLimit
    {
      try manager.copyItem(at: previous, to: payload.appending(path: "previous.ndjson"))
    }
    try (Self.readme + "\n" + notes).write(
      to: payload.appending(path: "README.txt"), atomically: true, encoding: .utf8)
    let archive = staging.appending(path: "report.zip")
    let process = Process()
    process.executableURL = URL(filePath: "/usr/bin/ditto")
    process.arguments = [
      "-c", "-k", "--keepParent", "--norsrc", "--noextattr", "--noqtn", payload.path, archive.path,
    ]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw CocoaError(.fileWriteUnknown) }
    let scoped = destination.startAccessingSecurityScopedResource()
    defer { if scoped { destination.stopAccessingSecurityScopedResource() } }
    try Data(contentsOf: archive).write(to: destination, options: .atomic)
  }

  private static let readme = """
    Atd support diagnostic report, schema 2

    current.ndjson: this launch, ordered by sequence; each record has a session, module, wall time
    and monotonic uptime. previous.ndjson: previous launch of the SAME profile AND exact build
    (app version, build number and diagnostic revision), if verified and available.
    manifest.json: exact build/profile, enabled collectors, event counts, coverage and losses.
    Distinct sessions are never one continuous trace. Counts include evicted records.

    Begin with manifest.json: check build, collectors, droppedRecords, encodingFailures and
    checkpointFailed. Zero events or unavailable coverage do not prove the absence of a fault.
    Match begin/result/end records by correlation within a session. Compare bridge, relay and
    renderer evidence. runtime.sample and renderer heartbeat elapsed times reveal delayed loops;
    snapshotMs measures observer overhead. A start without an end can also mean eviction or crash.

    The runtime profile covers shell/renderer lifecycle, native bridge calls, service endpoint
    changes, relayed HTTP outcomes and stream connections. It does not collect service internals,
    model requests, plugin internals or arbitrary console output. The focus profile adds window
    system snapshots, AX focused application facts and mouse-only event monitors.

    No chat contents, key presses, request bodies, URLs, tokens, window titles or screenshots.
    Files stay local until explicitly shared. Two traces, each at most 8 MiB / 3000 records;
    checkpoints every five seconds. A crash may lose the last checkpoint interval.
    A changed, missing or invalid build marker discards only the recorder's two cached traces.
    Exported ZIPs and product data are never removed. Preparation failure disables disk recording
    for this launch; checkpointFailed is true and export uses current memory without previous.
    A saved ZIP stops recording and requests deletion of the internal traces; any state/cache
    cleanup failure is reported separately. Persisted stopped builds stay stopped on restart.
    Settings can explicitly start a fresh recording; a new diagnostic build starts automatically.
    Canceling or failing to save a ZIP keeps recording and evidence. Removing the app does not
    delete exported ZIPs. The small build/state marker remains to remember completion.
    Export freezes evidence before the save dialog opens. No report is automatically uploaded.
    """
}
