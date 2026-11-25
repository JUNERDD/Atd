import Darwin
import Foundation
import MCP
import System

/// Actor-owned stdio transport for one ``BrowserWorkerProcess``. Owning both `FileHandle`s inside
/// this actor guarantees that `fcntl`, `read`, `write` and `close` are serialized against explicit
/// `.idle -> .connected -> .closed` state transitions, and FIFO write queuing guarantees each
/// newline-delimited JSON-RPC frame is written contiguously across `EAGAIN` yields without
/// blocking ``disconnect()``.
actor BrowserWorkerTransport: Transport {
  private enum State {
    case idle
    case connected
    case closed
  }

  private enum ReadStep {
    case bytes(Int)
    case eof
    case wouldBlock
    case failed(Int32)
  }

  private enum WriteStep {
    case written(Int)
    case wouldBlock
    case failed(Int32)
  }

  nonisolated let logger = StdioTransport().logger

  private let input: FileHandle
  private let output: FileHandle
  private var state: State = .idle
  private var readTask: Task<Void, Never>?
  private var isWriting = false
  private var writeQueue: [(id: UUID, continuation: CheckedContinuation<Bool, Never>)] = []
  private let messageStream: AsyncThrowingStream<Data, any Error>
  private let messageContinuation: AsyncThrowingStream<Data, any Error>.Continuation

  init(input: FileHandle, output: FileHandle) {
    self.input = input
    self.output = output
    let (stream, continuation) = AsyncThrowingStream.makeStream(
      of: Data.self, throwing: (any Error).self)
    self.messageStream = stream
    self.messageContinuation = continuation
  }

  deinit {
    try? input.close()
    try? output.close()
  }

  func connect() async throws {
    switch state {
    case .idle:
      do {
        try Self.setNonBlocking(input.fileDescriptor)
        try Self.setNonBlocking(output.fileDescriptor)
      } catch {
        abortTransport(error: error)
        throw error
      }
      state = .connected
      readTask = Task { await self.readLoop() }
    case .connected:
      return
    case .closed:
      throw Self.disconnectedError()
    }
  }

  func disconnect() async {
    abortTransport(error: Self.disconnectedError())
  }

  func send(_ message: Data) async throws {
    guard await acquireWriteTurn() else { throw Self.disconnectedError() }
    var remaining = message
    remaining.append(UInt8(ascii: "\n"))
    var startedFrame = false
    defer {
      if startedFrame, !remaining.isEmpty {
        abortTransport(error: Self.disconnectedError())
      } else {
        releaseWriteTurn()
      }
    }
    while !remaining.isEmpty {
      if Task.isCancelled || state != .connected { throw Self.disconnectedError() }
      switch writeOnce(remaining) {
      case .written(let count):
        if count > 0 {
          startedFrame = true
          remaining = remaining.dropFirst(count)
        }
      case .wouldBlock:
        try await Task.sleep(for: .milliseconds(10))
      case .failed(let code):
        throw MCPError.transportError(Errno(rawValue: code))
      }
    }
  }

  func receive() -> AsyncThrowingStream<Data, any Error> {
    messageStream
  }

  private func acquireWriteTurn() async -> Bool {
    guard state == .connected, !Task.isCancelled else { return false }
    if !isWriting {
      isWriting = true
      return true
    }
    let waiterID = UUID()
    return await withTaskCancellationHandler {
      await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
        guard state == .connected, !Task.isCancelled else {
          continuation.resume(returning: false)
          return
        }
        if !isWriting {
          isWriting = true
          continuation.resume(returning: true)
          return
        }
        writeQueue.append((id: waiterID, continuation: continuation))
      }
    } onCancel: {
      Task { await self.cancelWriteWaiter(waiterID) }
    }
  }

  private func releaseWriteTurn() {
    guard state == .connected, !writeQueue.isEmpty else {
      isWriting = false
      let drained = writeQueue
      writeQueue = []
      for waiter in drained { waiter.continuation.resume(returning: false) }
      return
    }
    let next = writeQueue.removeFirst()
    next.continuation.resume(returning: true)
  }

  private func cancelWriteWaiter(_ id: UUID) {
    guard let index = writeQueue.firstIndex(where: { $0.id == id }) else { return }
    let waiter = writeQueue.remove(at: index)
    waiter.continuation.resume(returning: false)
  }

  private func abortTransport(error: any Error) {
    guard state != .closed else { return }
    state = .closed
    let task = readTask
    readTask = nil
    task?.cancel()
    isWriting = false
    let drained = writeQueue
    writeQueue = []
    for waiter in drained { waiter.continuation.resume(returning: false) }
    closeHandles()
    messageContinuation.finish(throwing: error)
  }

  private func readLoop() async {
    var buffer = [UInt8](repeating: 0, count: 4096)
    var pending = Data()
    var exitCode: Int32 = ENOTCONN
    loop: while state == .connected, !Task.isCancelled {
      switch readOnce(&buffer) {
      case .bytes(let count):
        pending.append(contentsOf: buffer[..<count])
        while let newline = pending.firstIndex(of: UInt8(ascii: "\n")) {
          let line = pending[..<newline]
          pending = Data(pending[(newline + 1)...])
          if !line.isEmpty { messageContinuation.yield(Data(line)) }
        }
      case .eof:
        break loop
      case .wouldBlock:
        try? await Task.sleep(for: .milliseconds(10))
      case .failed(let code):
        exitCode = code
        break loop
      }
    }
    abortTransport(error: MCPError.transportError(Errno(rawValue: exitCode)))
  }

  private func readOnce(_ buffer: inout [UInt8]) -> ReadStep {
    guard state == .connected else { return .failed(ENOTCONN) }
    let fd = input.fileDescriptor
    let count = buffer.withUnsafeMutableBytes { raw -> Int in
      guard let base = raw.baseAddress else { return 0 }
      return Darwin.read(fd, base, raw.count)
    }
    if count > 0 { return .bytes(count) }
    if count == 0 { return .eof }
    let code = errno
    if code == EAGAIN || code == EWOULDBLOCK || code == EINTR { return .wouldBlock }
    return .failed(code)
  }

  private func writeOnce(_ data: Data) -> WriteStep {
    guard state == .connected else { return .failed(ENOTCONN) }
    let fd = output.fileDescriptor
    let count = data.withUnsafeBytes { raw -> Int in
      guard let base = raw.baseAddress else { return 0 }
      return Darwin.write(fd, base, raw.count)
    }
    if count >= 0 { return .written(count) }
    let code = errno
    if code == EAGAIN || code == EWOULDBLOCK || code == EINTR { return .wouldBlock }
    return .failed(code)
  }

  private func closeHandles() {
    try? input.close()
    try? output.close()
  }

  nonisolated private static func setNonBlocking(_ fd: Int32) throws {
    let flags = fcntl(fd, F_GETFL)
    guard flags >= 0 else { throw MCPError.transportError(Errno(rawValue: errno)) }
    guard fcntl(fd, F_SETFL, flags | O_NONBLOCK) >= 0 else {
      throw MCPError.transportError(Errno(rawValue: errno))
    }
  }

  nonisolated private static func disconnectedError() -> MCPError {
    MCPError.transportError(Errno(rawValue: ENOTCONN))
  }
}
