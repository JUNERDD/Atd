import AICore
import Foundation
import MCP
import System

/// One generation of the browser worker (`apps/agent-service/src/computer/worker/`, playwright-core
/// over CDP): the bundled Node running the built worker for one managed profile or one connected
/// Chrome of the person's, spoken to with the Swift MCP SDK's `Client` over a `StdioTransport` on
/// the child's pipes. Its environment names the browser's verified websocket (`ATD_CDP_WS`), the
/// task resource store uploads must come from (`ATD_UPLOAD_ROOT`) and, for the person's own
/// Chrome only, the channel (`ATD_BROWSER_CHANNEL=chrome`); the directory a call's downloads go to
/// is an argument of that call. Only the worker's closed tool set is called, and a call whose
/// outcome was not seen is never sent again.
///
/// The worker exits when its stdin closes, which also happens when the shell dies: both pipe
/// ends the host keeps are close-on-exec, so no other child inherits them.
actor BrowserWorkerProcess {
  struct Launch: Sendable {
    let node: URL
    let worker: URL
    /// The browser websocket of the profile's managed Chrome, or of the relay to the person's
    /// own Chrome, as the host verified or serves it.
    let webSocket: String
    let channel: BrowserWorkerChannel
    /// `<dataDir>/resources`: the only directory upload files may come from.
    let uploadRoot: URL
    let log: URL
  }

  /// The tools the host may call; the worker's `capabilities` is for the pack check only, and
  /// its `downloads` listing is not used: each call reports its own downloads. `page_focus` reads
  /// whether the person is using a page, `open_page` opens an approved website's page in a
  /// background tab (or a parked background window), and `restore_windows` puts parked windows
  /// back on a display for a person who opens the browser; no tool focuses, raises or activates
  /// anything. The worker refuses the last two in the person's own Chrome, where the host never
  /// calls them.
  static let tools: Set<String> = [
    "list_pages", "observe", "fill", "press", "scroll", "wait", "navigate", "key", "select",
    "upload", "cancel", "preview_start", "preview_read", "preview_stop", "page_focus", "open_page",
    "restore_windows",
  ]
  /// Bound for writing an MCP `notifications/cancelled` before assuming the worker's stdio pipe
  /// is wedged and force-stopping the process.
  private static let cancelNotificationLimit: Duration = .milliseconds(500)

  let generation: Int
  private let process: Process
  private let client: Client
  private let transport: BrowserWorkerTransport
  private var exited = false
  private var stopTask: Task<Void, Never>?
  private var connectWaiter: BrowserWorkerSignalWaiter?
  private var activeCalls: [UUID: BrowserWorkerCallWaiter] = [:]

  private init(
    generation: Int, process: Process, client: Client, transport: BrowserWorkerTransport
  ) {
    self.generation = generation
    self.process = process
    self.client = client
    self.transport = transport
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
    _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
    _ = fcntl(output.fileHandleForReading.fileDescriptor, F_SETFD, FD_CLOEXEC)
    let transport = BrowserWorkerTransport(
      input: output.fileHandleForReading, output: input.fileHandleForWriting)
    let worker = BrowserWorkerProcess(
      generation: generation, process: process, client: Client(name: "Atd", version: "1"),
      transport: transport)
    process.terminationHandler = { _ in
      Task { await worker.handleProcessExit() }
    }
    do {
      try process.run()
    } catch {
      process.terminationHandler = nil
      await transport.disconnect()
      throw error
    }
    do {
      try await worker.connect(timeout: timeout)
    } catch {
      await worker.stop(force: true)
      throw error
    }
    return worker
  }

  var isRunning: Bool { !exited && stopTask == nil && process.isRunning }

  /// Calls one tool of the closed set and decodes its structured result. A refusal or failure
  /// the worker reports is a reply (`ok: false`), not a thrown error.
  func call(_ tool: String, _ arguments: [String: Value], timeout: Duration)
    async throws(BrowserWorkerCallError) -> BrowserWorkerReply
  {
    guard Self.tools.contains(tool) else { throw .rejected("\(tool) is not a worker tool.") }
    guard isRunning else { throw .exited }
    if Task.isCancelled { throw .cancelled(sent: false) }
    let context: RequestContext<CallTool.Result>
    do {
      context = try await client.send(
        CallTool.request(.init(name: tool, arguments: arguments)))
    } catch {
      throw isRunning ? .failed(String(describing: error)) : .exited
    }
    let id = UUID()
    let waiter = BrowserWorkerCallWaiter()
    activeCalls[id] = waiter
    defer { activeCalls[id] = nil }
    if !isRunning { waiter.finish(.exited) }
    let responseTask = Task {
      do {
        waiter.finish(.completed(try await context.value))
      } catch {
        waiter.finish(.failed(error))
      }
    }
    let timerTask = Task {
      do {
        try await Task.sleep(for: timeout)
        waiter.finish(.timedOut)
      } catch {}
    }
    let outcome = await withTaskCancellationHandler {
      await waiter.wait()
    } onCancel: {
      waiter.finish(.cancelled)
    }
    timerTask.cancel()
    responseTask.cancel()
    switch outcome {
    case .completed(let result):
      return try Self.reply(result, of: tool)
    case .timedOut:
      await cancelRequestBounded(context.requestID, reason: "timed out")
      throw .timedOut
    case .cancelled:
      await cancelRequestBounded(context.requestID, reason: "cancelled")
      throw .cancelled(sent: true)
    case .exited:
      throw .exited
    case .failed(let error):
      throw isRunning ? .failed(String(describing: error)) : .exited
    }
  }

  /// The worker's reply in one tool result. A result without structured content is the SDK
  /// refusing the arguments (`isError`): its text items, joined and cut to 500 characters, say why.
  nonisolated static func reply(_ result: CallTool.Result, of tool: String)
    throws(BrowserWorkerCallError) -> BrowserWorkerReply
  {
    guard let structured = result.structuredContent else {
      let text = result.content.compactMap {
        if case .text(let text, _, _) = $0 { text } else { nil }
      }
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
  /// SIGKILL, and returns once Foundation reaped the process. With `force`, immediately sends
  /// SIGKILL so an unresponsive worker cannot flush buffered CDP writes while its claim settles.
  func stop(force: Bool = false) async {
    if force, process.isRunning { kill(process.processIdentifier, SIGKILL) }
    if let existing = stopTask {
      await existing.value
      return
    }
    let task = Task { await self.performStop(force: force) }
    stopTask = task
    await task.value
  }

  private func performStop(force: Bool) async {
    if force, process.isRunning { kill(process.processIdentifier, SIGKILL) }
    await transport.disconnect()
    await client.disconnect()
    if !force {
      let stages: [(Duration, Int32)] = [(.seconds(3), SIGTERM), (.seconds(2), SIGKILL)]
      for (limit, signal) in stages {
        let deadline = ContinuousClock.now.advanced(by: limit)
        while process.isRunning, ContinuousClock.now < deadline {
          try? await Task.sleep(for: .milliseconds(20))
        }
        if !process.isRunning { break }
        kill(process.processIdentifier, signal)
      }
    }
    while process.isRunning { try? await Task.sleep(for: .milliseconds(5)) }
    exited = true
    failPendingWaiters()
  }

  /// Wakes every in-flight call on unexpected exit and disconnects the transport and `MCP.Client`.
  private func handleProcessExit() async {
    exited = true
    failPendingWaiters()
    await transport.disconnect()
    await client.disconnect()
  }

  private func failPendingWaiters() {
    connectWaiter?.finish(.exited)
    connectWaiter = nil
    for waiter in activeCalls.values { waiter.finish(.exited) }
    activeCalls = [:]
  }

  private func cancelRequestBounded(_ requestID: ID, reason: String) async {
    let client = client
    let done = BrowserWorkerSignalWaiter()
    let cancelTask = Task {
      try? await client.cancelRequest(requestID, reason: reason)
      done.finish(.completed)
    }
    let timerTask = Task {
      do {
        try await Task.sleep(for: Self.cancelNotificationLimit)
        done.finish(.timedOut)
      } catch {}
    }
    let outcome = await done.wait()
    timerTask.cancel()
    if case .timedOut = outcome {
      cancelTask.cancel()
      Task { await self.stop(force: true) }
    }
  }

  private func connect(timeout: Duration) async throws {
    guard isRunning else { throw BrowserWorkerCallError.exited }
    if Task.isCancelled { throw BrowserWorkerCallError.cancelled(sent: false) }
    let transport = transport
    let client = client
    let waiter = BrowserWorkerSignalWaiter()
    connectWaiter = waiter
    defer { connectWaiter = nil }
    if !isRunning { waiter.finish(.exited) }
    let connectTask = Task {
      do {
        _ = try await client.connect(transport: transport)
        waiter.finish(.completed)
      } catch {
        waiter.finish(.failed(error))
      }
    }
    let timerTask = Task {
      do {
        try await Task.sleep(for: timeout)
        waiter.finish(.timedOut)
      } catch {}
    }
    let outcome = await withTaskCancellationHandler {
      await waiter.wait()
    } onCancel: {
      waiter.finish(.cancelled)
    }
    timerTask.cancel()
    connectTask.cancel()
    switch outcome {
    case .completed: return
    case .timedOut: throw BrowserWorkerCallError.timedOut
    case .cancelled: throw BrowserWorkerCallError.cancelled(sent: false)
    case .exited: throw BrowserWorkerCallError.exited
    case .failed(let error):
      if !isRunning { throw BrowserWorkerCallError.exited }
      throw error
    }
  }

  /// Built from scratch: the browser endpoint, the upload root, a home and a fixed `PATH`, plus
  /// the channel for the person's own Chrome (a managed profile's worker gets exactly the
  /// variables it always did); nothing of the shell's own environment (no `NODE_OPTIONS`, no proxy
  /// or token variables) reaches the worker.
  private static func environment(_ launch: Launch) -> [String: String] {
    var environment = [
      "ATD_CDP_WS": launch.webSocket,
      "ATD_UPLOAD_ROOT": launch.uploadRoot.path(percentEncoded: false),
      "PATH": "/usr/bin:/bin",
      "HOME": FileManager.default.homeDirectoryForCurrentUser.path(percentEncoded: false),
    ]
    if launch.channel == .chrome { environment["ATD_BROWSER_CHANNEL"] = "chrome" }
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
}
