import Darwin
import Foundation

/// How the shell starts the background driver `atd-computer-driver` (plan §2.3): the helper this
/// build embeds, spawned directly as a child (`Process`, never LaunchServices or the agent
/// service), so macOS answers its Accessibility and PostEvent checks with Atd's grants.
nonisolated struct DriverLaunch: Equatable, Sendable {
  static let executableName = "atd-computer-driver"

  let executable: URL
  /// Where the driver's stderr (logs only, never frames) goes.
  let log: URL
  /// Stamped into every synthetic event (`AI_COMPUTER_DRIVER_GENERATION`), raised on each start,
  /// so a passive monitor attributes a generation's input (plan I8).
  let generation: Int

  /// The embedded helper: the app's `Contents/MacOS/atd-computer-driver`, or the file of that
  /// name beside a SwiftPM-built executable; nil when this build has none.
  static func bundled(_ bundle: Bundle = .main) -> URL? {
    bundle.url(forAuxiliaryExecutable: executableName)
  }

  /// The child's whole environment, built from scratch: the few variables a macOS process needs
  /// from the shell and the generation. Nothing else of the app's environment reaches it.
  func environment(inheriting parent: [String: String]) -> [String: String] {
    var environment = parent.filter { name, _ in
      ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"].contains(name) || name.hasPrefix("LC_")
    }
    environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
    environment["AI_COMPUTER_DRIVER_GENERATION"] = String(generation)
    return environment
  }
}

/// One running driver and the pipe ends the host keeps: the child's stdin (request frames, and
/// the parent-liveness signal: the driver exits at EOF) and its stdout (response and event
/// frames). Both ends are close-on-exec, so no other child of the shell (the agent service, a
/// browser worker) inherits them and keeps a driver alive after the shell dies, and the write
/// end never raises SIGPIPE: a write to a driver that is gone fails instead.
nonisolated final class DriverProcess: @unchecked Sendable {
  private let process: Process
  private let toDriver: FileHandle
  private let fromDriver: FileHandle
  private let writeLock = NSLock()

  private init(process: Process, toDriver: FileHandle, fromDriver: FileHandle) {
    self.process = process
    self.toDriver = toDriver
    self.fromDriver = fromDriver
  }

  var processIdentifier: pid_t { process.processIdentifier }
  var isRunning: Bool { process.isRunning }

  /// Starts the driver; `chunks` then yields what it writes to stdout until EOF.
  static func launch(_ launch: DriverLaunch) throws -> (DriverProcess, AsyncStream<Data>) {
    let input = Pipe()
    let output = Pipe()
    let process = Process()
    process.executableURL = launch.executable
    process.arguments = []
    process.environment = launch.environment(inheriting: ProcessInfo.processInfo.environment)
    process.standardInput = input
    process.standardOutput = output
    let log = try logHandle(launch.log)
    defer { try? log.close() }
    process.standardError = log
    _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETFD, FD_CLOEXEC)
    _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
    _ = fcntl(output.fileHandleForReading.fileDescriptor, F_SETFD, FD_CLOEXEC)
    let (chunks, continuation) = AsyncStream<Data>.makeStream()
    // Foundation closes the host's copies of the child's pipe ends, so the driver's exit reaches
    // the reader as EOF; the termination handler only backs that up once buffered frames drained.
    process.terminationHandler = { _ in
      DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { continuation.finish() }
    }
    try process.run()
    output.fileHandleForReading.readabilityHandler = { handle in
      let data = handle.availableData
      if data.isEmpty {
        handle.readabilityHandler = nil
        continuation.finish()
      } else {
        continuation.yield(data)
      }
    }
    let driver = DriverProcess(
      process: process, toDriver: input.fileHandleForWriting,
      fromDriver: output.fileHandleForReading)
    return (driver, chunks)
  }

  /// Writes one whole frame; false when the driver is gone (its stdin closed).
  func write(_ frame: Data) -> Bool {
    writeLock.lock()
    defer { writeLock.unlock() }
    let descriptor = toDriver.fileDescriptor
    return frame.withUnsafeBytes { raw -> Bool in
      guard let base = raw.baseAddress else { return true }
      var offset = 0
      while offset < raw.count {
        let wrote = Darwin.write(descriptor, base + offset, raw.count - offset)
        if wrote > 0 {
          offset += wrote
        } else if wrote < 0, errno == EINTR {
          continue
        } else {
          return false
        }
      }
      return true
    }
  }

  /// Closes the driver's stdin (it exits at EOF and restores what it pinned), then escalates to
  /// SIGTERM and SIGKILL when it does not exit, and returns once Foundation reaped it.
  func stop() async {
    writeLock.withLock { try? toDriver.close() }
    for (limit, signal) in [(Duration.seconds(3), SIGTERM), (.seconds(2), SIGKILL)] {
      let deadline = ContinuousClock.now.advanced(by: limit)
      while process.isRunning, ContinuousClock.now < deadline {
        try? await Task.sleep(for: .milliseconds(20))
      }
      guard process.isRunning else { break }
      Darwin.kill(process.processIdentifier, signal)
    }
    while process.isRunning { try? await Task.sleep(for: .milliseconds(20)) }
    fromDriver.readabilityHandler = nil
    try? fromDriver.close()
  }

  /// Ends a driver that broke its own deadline or the stream: SIGKILL at once, so input it may
  /// still be sending stops with the process.
  func terminateNow() {
    Darwin.kill(process.processIdentifier, SIGKILL)
  }

  /// Appends to `url`, created owner-only, starting over once it passes 1 MB.
  private static func logHandle(_ url: URL) throws -> FileHandle {
    let manager = FileManager.default
    let path = url.path(percentEncoded: false)
    try manager.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let size = (try? manager.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
    if size > 1_000_000 || !manager.fileExists(atPath: path) {
      manager.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600])
    }
    let handle = try FileHandle(forWritingTo: url)
    try handle.seekToEnd()
    return handle
  }
}
