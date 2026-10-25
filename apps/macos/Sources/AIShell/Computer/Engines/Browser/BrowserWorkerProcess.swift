import AICore
import Foundation
import MCP
import System

/// Why a call to the browser worker produced no reply of its own.
enum BrowserWorkerCallError: Error, Equatable {
  /// The worker process is gone; whatever the call sent may or may not have reached the page.
  case exited
  /// No reply within the call's limit; the request was cancelled and its effect is unknown.
  case timedOut
  /// The SDK refused the arguments (`isError` without structured content): nothing was sent.
  case rejected(String)
  /// A reply that is not the worker's result shape, or a transport failure mid-call.
  case failed(String)
  /// No worker could be started for the call, so nothing was sent.
  case unavailable(String)
  /// The call names element refs or a baseline of another worker generation; nothing was sent.
  case generationChanged
}

/// One generation of the browser worker (`apps/agent-service/src/computer/worker/`, playwright-core
/// over CDP): the bundled Node running the built worker for one managed profile, spoken to with
/// the Swift MCP SDK's `Client` over a `StdioTransport` on the child's pipes. Its environment names the profile's verified browser websocket
/// (`ATD_CDP_WS`) and the task resource store uploads must come from (`ATD_UPLOAD_ROOT`); the
/// directory a call's downloads go to is an argument of that call. Only the worker's closed tool
/// set is called, and a call whose outcome was not seen is never sent again.
///
/// The worker exits when its stdin closes, which also happens when the shell dies: both pipe
/// ends the host keeps are close-on-exec, so no other child inherits them.
actor BrowserWorkerProcess {
  struct Launch: Sendable {
    let node: URL
    let worker: URL
    /// The browser websocket of the profile's managed Chrome, as the host verified it.
    let webSocket: String
    /// `<dataDir>/resources`: the only directory upload files may come from.
    let uploadRoot: URL
    let log: URL
  }

  /// The tools the host may call; the worker's `capabilities` is for the pack check only, and
  /// its `downloads` listing is not used: each call reports its own downloads. `page_focus` reads
  /// whether the person is using a page, `open_page` opens an approved website's page in a
  /// background tab (or a parked background window), and `restore_windows` puts parked windows
  /// back on a display for a person who opens the browser; no tool focuses, raises or activates
  /// anything.
  static let tools: Set<String> = [
    "list_pages", "observe", "fill", "press", "scroll", "wait", "navigate", "key", "select",
    "upload", "cancel", "preview_start", "preview_read", "preview_stop", "page_focus", "open_page",
    "restore_windows",
  ]

  let generation: Int
  private let process: Process
  private let client: Client
  private let toWorker: FileHandle
  private let fromWorker: FileHandle

  private init(
    generation: Int, process: Process, client: Client, toWorker: FileHandle,
    fromWorker: FileHandle
  ) {
    self.generation = generation
    self.process = process
    self.client = client
    self.toWorker = toWorker
    self.fromWorker = fromWorker
  }

  /// Starts the worker and completes the MCP handshake within `timeout`.
  static func start(_ launch: Launch, generation: Int, timeout: Duration) async throws
    -> BrowserWorkerProcess
  {
    let input = Pipe()
    let output = Pipe()
    let process = Process()
    process.executableURL = launch.node
    process.arguments = [launch.worker.path(percentEncoded: false)]
    process.currentDirectoryURL = launch.worker.deletingLastPathComponent()
    process.environment = environment(launch)
    process.standardInput = input
    process.standardOutput = output
    let log = try logHandle(launch.log)
    defer { try? log.close() }
    process.standardError = log
    _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETFD, FD_CLOEXEC)
    _ = fcntl(output.fileHandleForReading.fileDescriptor, F_SETFD, FD_CLOEXEC)
    try process.run()
    let worker = BrowserWorkerProcess(
      generation: generation, process: process, client: Client(name: "Atd", version: "1"),
      toWorker: input.fileHandleForWriting, fromWorker: output.fileHandleForReading)
    do {
      try await worker.connect(timeout: timeout)
    } catch {
      await worker.stop()
      throw error
    }
    return worker
  }

  var isRunning: Bool { process.isRunning }

  /// Calls one tool of the closed set and decodes its structured result. A refusal or failure
  /// the worker reports is a reply (`ok: false`), not a thrown error.
  func call(_ tool: String, _ arguments: [String: Value], timeout: Duration)
    async throws(BrowserWorkerCallError) -> BrowserWorkerReply
  {
    guard Self.tools.contains(tool) else { throw .rejected("\(tool) is not a worker tool.") }
    guard process.isRunning else { throw .exited }
    let result: CallTool.Result
    do {
      let context: RequestContext<CallTool.Result> = try await client.send(
        CallTool.request(.init(name: tool, arguments: arguments)))
      guard let reply = try await Self.within(timeout, { try await context.value }) else {
        try? await client.cancelRequest(context.requestID, reason: "timed out")
        throw BrowserWorkerCallError.timedOut
      }
      result = reply
    } catch let error as BrowserWorkerCallError {
      throw error
    } catch {
      throw process.isRunning ? .failed(String(describing: error)) : .exited
    }
    guard let structured = result.structuredContent else {
      let text = result.content.compactMap { if case .text(let text) = $0 { text } else { nil } }
      throw .rejected(String(text.joined(separator: " ").prefix(500)))
    }
    do {
      return try JSONDecoder().decode(
        BrowserWorkerReply.self, from: try JSONEncoder().encode(structured))
    } catch {
      throw .failed("The worker sent a malformed \(tool) result.")
    }
  }

  /// Disconnects, closes the worker's stdin (it exits on EOF), then escalates to SIGTERM and
  /// SIGKILL, and returns once Foundation reaped the process.
  func stop() async {
    await client.disconnect()
    try? toWorker.close()
    try? fromWorker.close()
    for (limit, signal) in [(Duration.seconds(3), SIGTERM), (.seconds(2), SIGKILL)] {
      let deadline = ContinuousClock.now.advanced(by: limit)
      while process.isRunning, ContinuousClock.now < deadline {
        try? await Task.sleep(for: .milliseconds(20))
      }
      guard process.isRunning else { return }
      kill(process.processIdentifier, signal)
    }
    while process.isRunning { try? await Task.sleep(for: .milliseconds(20)) }
  }

  private func connect(timeout: Duration) async throws {
    let transport = StdioTransport(
      input: FileDescriptor(rawValue: fromWorker.fileDescriptor),
      output: FileDescriptor(rawValue: toWorker.fileDescriptor))
    let client = client
    guard
      try await Self.within(timeout, { _ = try await client.connect(transport: transport) })
        != nil
    else { throw BrowserWorkerCallError.timedOut }
  }

  /// Built from scratch: the browser endpoint, the upload root, a home and a fixed `PATH`;
  /// nothing of the shell's own environment (no `NODE_OPTIONS`, no proxy or token variables)
  /// reaches the worker.
  private static func environment(_ launch: Launch) -> [String: String] {
    var environment = [
      "ATD_CDP_WS": launch.webSocket,
      "ATD_UPLOAD_ROOT": launch.uploadRoot.path(percentEncoded: false),
      "PATH": "/usr/bin:/bin",
      "HOME": FileManager.default.homeDirectoryForCurrentUser.path(percentEncoded: false),
    ]
    if let tmp = ProcessInfo.processInfo.environment["TMPDIR"] { environment["TMPDIR"] = tmp }
    return environment
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

  /// `operation`'s result, or nil when `limit` passes first (the operation is then cancelled).
  private static func within<T: Sendable>(
    _ limit: Duration, _ operation: @escaping @Sendable () async throws -> T
  ) async throws -> T? {
    try await withThrowingTaskGroup(of: T?.self) { group in
      group.addTask { try await operation() }
      group.addTask {
        try await Task.sleep(for: limit)
        return nil
      }
      let first = try await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }
}
