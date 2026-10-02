import AICore
import Foundation

/// A service child process this shell spawned (`startLocalService` in `launcher.ts`, packaged
/// branch). Its stdout and stderr go straight to a log file, never a pipe, so it cannot block
/// on a reader that went away.
final class ServiceProcess {
  let process: Process
  let log: URL
  private let logStart: UInt64
  /// Runs once when the process exits, whatever the reason.
  var onExit: (@MainActor (_ description: String) -> Void)?

  private init(process: Process, log: URL, logStart: UInt64) {
    self.process = process
    self.log = log
    self.logStart = logStart
  }

  var pid: Int32 { process.processIdentifier }
  var isRunning: Bool { process.isRunning }

  /// Rotates the logs, starts `node <cli.js> serve …` and returns without waiting for it.
  static func launch(_ plan: ServiceLaunchPlan, logDirectory: URL) throws -> ServiceProcess {
    let manager = FileManager.default
    try manager.createDirectory(at: logDirectory, withIntermediateDirectories: true)
    for rename in ServiceLogRotation.renames() {
      let from = logDirectory.appending(path: rename.from)
      let to = logDirectory.appending(path: rename.to)
      try? manager.removeItem(at: to)
      try? manager.moveItem(at: from, to: to)
    }
    let log = logDirectory.appending(path: ServiceLogRotation.current)
    if !manager.fileExists(atPath: log.path) {
      manager.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600])
    }
    let handle = try FileHandle(forWritingTo: log)
    defer { try? handle.close() }
    let start = try handle.seekToEnd()

    let process = Process()
    process.executableURL = plan.node
    process.arguments = plan.arguments
    process.environment = plan.environment(inheriting: ProcessInfo.processInfo.environment)
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = handle
    process.standardError = handle
    let child = ServiceProcess(process: process, log: log, logStart: start)
    process.terminationHandler = { finished in
      let description =
        finished.terminationReason == .uncaughtSignal
        ? "was stopped by signal \(finished.terminationStatus)"
        : "exited with code \(finished.terminationStatus)"
      DispatchQueue.main.async {
        MainActor.assumeIsolated {
          let onExit = child.onExit
          child.onExit = nil
          onExit?(description)
        }
      }
    }
    try process.run()
    return child
  }

  /// Polls until this process publishes its endpoint (`waitForEndpoint`); another live service's
  /// endpoint does not count. Fails as soon as the process exits, with the reason it logged.
  func waitForEndpoint(dataDirectory: URL, timeout: Duration = .seconds(15)) async throws
    -> ServiceEndpoint
  {
    let deadline = ContinuousClock.now.advanced(by: timeout)
    while true {
      guard isRunning else { throw ServiceStartError(message: startupFailureMessage()) }
      if case .success(let endpoint) = ServiceDiscovery.read(dataDirectory: dataDirectory),
        endpoint.pid == pid
      {
        return endpoint
      }
      guard ContinuousClock.now < deadline else {
        process.terminate()
        throw ServiceStartError(message: "The service did not publish its endpoint in time.")
      }
      try await Task.sleep(for: .milliseconds(20))
    }
  }

  /// The first `SyntaxError:`/`Error:` line this launch logged, else its last plain lines
  /// (`startupFailureMessage` in `service-log.ts`).
  func startupFailureMessage() -> String {
    let status =
      process.isRunning
      ? "stopped" : "exited with code \(process.terminationStatus)"
    guard let handle = try? FileHandle(forReadingFrom: log) else {
      return "The agent service \(status)."
    }
    defer { try? handle.close() }
    let size = (try? handle.seekToEnd()) ?? 0
    let from = max(logStart, size > 16_384 ? size - 16_384 : 0)
    try? handle.seek(toOffset: from)
    let text = String(decoding: (try? handle.readToEnd()) ?? Data(), as: UTF8.self)
    let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    if let error = lines.first(where: { $0.hasPrefix("SyntaxError:") || $0.hasPrefix("Error:") }) {
      return String(error.prefix(500))
    }
    let plain = lines.filter { !$0.hasPrefix("{") }
    let tail = (plain.isEmpty ? lines : plain).suffix(4).joined(separator: " ")
    return String((tail.isEmpty ? "The agent service \(status)." : tail).prefix(500))
  }
}

struct ServiceStartError: Error, LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/// Stops whatever service serves `dataDirectory` (`stopLocalService`): ask it to shut down (SIGTERM
/// when asking fails), wait for its stop, and kill the process when it does not exit. A stop
/// never leaves the process behind: a quit is followed by Sparkle replacing the bundle it runs
/// from, and a start by a new service for the same data directory.
enum ServiceStopper {
  /// A graceful stop's budget. Draining runs includes each live session's shutdown flush, which
  /// may make a model call of up to 10 s.
  static let gracefulStop: Duration = .seconds(20)
  /// How long the process may take to exit once its stop has finished, or after SIGTERM.
  static let exitGrace: Duration = .seconds(2)

  static func stop(dataDirectory: URL) async {
    guard case .success(let endpoint) = ServiceDiscovery.read(dataDirectory: dataDirectory) else {
      return
    }
    do {
      try await ShellClient(endpoint: endpoint).shutdown()
    } catch {
      kill(endpoint.pid, SIGTERM)
    }
    // SIGTERM would add nothing here: the service's handler joins the stop already under way.
    _ = await waitForExit(endpoint.pid, timeout: gracefulStop) {
      stopFinished(endpoint.pid, dataDirectory: dataDirectory)
    }
    await ensureExit(endpoint.pid)
  }

  /// Gives `pid` ``exitGrace`` to exit, then SIGKILLs it. SIGTERM cannot end a Node process
  /// whose JavaScript no longer runs: one whose main thread is stuck in a synchronous call (a
  /// skill scan waiting on a macOS folder-access prompt), or one whose exit waits to join a
  /// libuv pool thread stuck in a blocking call.
  static func ensureExit(_ pid: Int32) async {
    if await waitForExit(pid, timeout: exitGrace) { return }
    RelayLog.service.error("The service (pid \(pid)) did not exit; killing it.")
    kill(pid, SIGKILL)
    _ = await waitForExit(pid, timeout: exitGrace)
  }

  /// True once `pid` exits. Polls far below a graceful shutdown's ~30 ms, since a restart waits
  /// on it; returns false at the timeout, or as soon as `done` holds.
  static func waitForExit(
    _ pid: Int32, timeout: Duration, orUntil done: () -> Bool = { false }
  ) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: timeout)
    while ContinuousClock.now <= deadline {
      if !isProcessAlive(pid) { return true }
      if done() { return false }
      try? await Task.sleep(for: .milliseconds(50))
    }
    return false
  }

  /// Clearing `endpoint.json` is the last step of the service's stop before it releases the
  /// data directory lock and exits (`stopService` in `index.ts`).
  private static func stopFinished(_ pid: Int32, dataDirectory: URL) -> Bool {
    switch ServiceDiscovery.read(dataDirectory: dataDirectory) {
    case .success(let endpoint): endpoint.pid != pid
    case .failure(.notRunning): true
    case .failure: false
    }
  }
}
