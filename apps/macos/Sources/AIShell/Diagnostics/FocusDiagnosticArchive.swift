import Foundation

/// Disk work stays off AppKit. Keeps at most two 8 MiB traces; each belongs to one app launch.
actor FocusDiagnosticArchive {
  private let directory: URL
  private var prepared = false
  private var lastSequence = 0
  private(set) var writeFailed = false
  static let byteLimit = 8 * 1024 * 1024

  init() {
    directory = FileManager.default.homeDirectoryForCurrentUser
      .appending(path: "Library/Logs/AtdFocusDiagnostics", directoryHint: .isDirectory)
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

  func export(current: Data, metadata: Data, to destination: URL) throws {
    let manager = FileManager.default
    let staging = manager.temporaryDirectory.appending(path: "Atd-focus-\(UUID().uuidString)")
    try manager.createDirectory(
      at: staging, withIntermediateDirectories: false,
      attributes: [.posixPermissions: 0o700])
    defer { try? manager.removeItem(at: staging) }
    try current.write(to: staging.appending(path: "current.ndjson"))
    try metadata.write(to: staging.appending(path: "manifest.json"))
    let previous = directory.appending(path: "previous.ndjson")
    if let size = try? previous.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size <= Self.byteLimit
    {
      try manager.copyItem(at: previous, to: staging.appending(path: "previous.ndjson"))
    }
    try Self.readme.write(
      to: staging.appending(path: "README.txt"), atomically: true, encoding: .utf8)
    let archive = staging.appending(path: "report.zip")
    let process = Process()
    process.executableURL = URL(filePath: "/usr/bin/ditto")
    // Explicit files avoid including the output archive or unrelated logs in the report.
    let payload = staging.appending(path: "report", directoryHint: .isDirectory)
    try manager.createDirectory(at: payload, withIntermediateDirectories: false)
    for file in try manager.contentsOfDirectory(at: staging, includingPropertiesForKeys: nil)
    where file != payload {
      try manager.moveItem(at: file, to: payload.appending(path: file.lastPathComponent))
    }
    process.arguments = ["-c", "-k", "--keepParent", payload.path, archive.path]
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
    Atd focus diagnostic report, schema 1

    current.ndjson: bounded trace of this app launch, ordered by sequence.
    previous.ndjson: previous diagnostic launch, when available; use its own session ID.
    manifest.json: build/system facts, recording coverage, counts and persistence status.
    Every record has wall time, system uptime and a session ID. Mouse timestamps are uptime.
    Cocoa coordinates are bottom-left; WindowServer/CGEvent coordinates are top-left.

    Start at native.activation.request and its correlation ID; compare the delayed snapshots.
    Compare mouse.tap -> mouse.local/global -> native.mouse.before/after -> renderer.pointerdown/click.
    Check frontmost, axFocus, appActive, keyWindow and Spotlight/Dock windows independently.
    If no native event arrived, compare the tap receiver hints, windowAtPointer, window layers,
    ignoresMouse, alpha, active Space, modal windows and hitViewClass.
    If activation was requested, compare all four follow-ups, not only the immediate snapshot.
    A periodic sample reports elapsed time to reveal a stalled main run loop. Window notifications
    and workspace events expose focus loss, occlusion and Space/display changes.
    Unavailable monitors/AX reads and missing renderer events are coverage gaps, not proof of no input.
    windowAtPointer and CGEvent window fields are hit-test hints; native receipt proves delivery.

    Recording is enabled only in a diagnostic build. Raw text, key presses, window titles,
    conversation content, URLs, credentials, screenshots and service logs are never collected.
    App bundle IDs, window geometry, mouse button events and OS permission states are included.
    The trace retains at most 8 MiB / 3000 records per launch and checkpoints every five seconds.
    Export freezes the in-memory trace before opening the save panel. Files stay local until shared.
    """
}
