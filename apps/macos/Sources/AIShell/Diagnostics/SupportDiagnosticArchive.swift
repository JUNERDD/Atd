import Foundation

/// Disk work stays off AppKit. Keeps at most two 8 MiB traces; each belongs to one app launch.
actor SupportDiagnosticArchive {
  private let directory: URL
  private var prepared = false
  private var lastSequence = 0
  private(set) var writeFailed = false
  static let byteLimit = 8 * 1024 * 1024

  init(profile: String) {
    directory = FileManager.default.homeDirectoryForCurrentUser
      .appending(path: "Library/Logs/AtdDiagnostics/\(profile)", directoryHint: .isDirectory)
  }

  func checkpoint(_ data: Data, sequence: Int) {
    guard sequence > lastSequence else { return }
    do {
      let manager = FileManager.default
      if !prepared {
        try manager.createDirectory(
          at: directory, withIntermediateDirectories: true,
          attributes: [.posixPermissions: 0o700])
        let previous = directory.appending(path: "previous.ndjson")
        let current = directory.appending(path: "current.ndjson")
        if manager.fileExists(atPath: current.path) {
          if manager.fileExists(atPath: previous.path) { try manager.removeItem(at: previous) }
          try manager.moveItem(at: current, to: previous)
        }
        prepared = true
      }
      let current = directory.appending(path: "current.ndjson")
      try data.write(to: current, options: .atomic)
      try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: current.path)
      lastSequence = sequence
      writeFailed = false
    } catch { writeFailed = true }
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
    if let size = try? previous.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size <= Self.byteLimit
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
    and monotonic uptime. previous.ndjson: previous launch of the SAME profile, if available.
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
    Export freezes evidence before the save dialog opens. No report is automatically uploaded.
    """
}
