import Darwin
import Dispatch
import Foundation
import os

/// Asynchronous, non-blocking shell flight recorder writing size-rotated JSONL logs (`01` §5).
///
/// - Bounded MPSC ring (`256` slots, `<= 384 B` scalar-aligned UTF-8 message per slot, `<= 128 KiB`
///   resident memory): callers never block; overflow increments `droppedCount` in `< 100 ns` and
///   emits a `shell_log_ring_overflow` record on the next flush.
/// - Uses cancellable `DispatchWorkItem` coalescing (`2s` default) on a serial `.utility` queue so
///   idle wakeup cost is `0` and rapid `deinit` never crashes a suspended `DispatchSourceTimer`.
public final class ShellLogWriter: Sendable {
  public enum Level: String, Codable, Sendable {
    case debug
    case info
    case warn
    case error
    case fault
  }

  /// Thread-safe wrapper for `DispatchWorkItem` (`cancel()` and `asyncAfter(execute:)` are
  /// thread-safe in `libdispatch`, and reference ownership is guarded by `OSAllocatedUnfairLock`).
  private struct FlushHandle: @unchecked Sendable {
    let item: DispatchWorkItem
  }

  private struct Slot: Sendable {
    var epochMs: Int64 = 0
    var level: Level = .info
    var category: InlineText64 = .empty
    var message = ""
  }

  private struct RingState: Sendable {
    var slots: ContiguousArray<Slot>
    var readIndex = 0
    var writeIndex = 0
    var count = 0
    var droppedCount: UInt64 = 0
    var pendingFlush: FlushHandle?
    var isClosed = false
  }

  private struct RecordPayload: Encodable {
    let ts: String
    let level: String
    let cat: String
    let msg: String
    let dropped: UInt64?
  }

  public static let defaultCapacity = 256
  public static let maxMessageUTF8Bytes = 384
  public static let immediateFlushThreshold = 64
  public static let defaultMaxFileBytes = 2_097_152  // 2 MiB
  public static let defaultMaxFiles = 5  // 2 MiB x 5 = 10 MiB

  public let logFileURL: URL
  public let capacity: Int
  public let maxFileBytes: Int
  public let maxFiles: Int
  public let coalesceDelay: DispatchTimeInterval

  private let lock: OSAllocatedUnfairLock<RingState>
  private let ioQueue = DispatchQueue(label: "com.junerdd.ai.shell-log-writer", qos: .utility)
  private let sink: ShellLogFileSink

  /// Resolves the isolated log destination (`~/Library/Logs/AI/shell.log` in Release vs
  /// `<dataDirectory>/logs/shell.log` in Development, never touching Release logs from Debug).
  public static func defaultLogURL(
    dataDirectory: URL,
    homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
    isDevelopment: Bool
  ) -> URL {
    if isDevelopment {
      return dataDirectory.appending(path: "logs/shell.log", directoryHint: .notDirectory)
    }
    return homeDirectory.appending(path: "Library/Logs/AI/shell.log", directoryHint: .notDirectory)
  }

  public init(
    logFileURL: URL,
    capacity: Int = ShellLogWriter.defaultCapacity,
    maxFileBytes: Int = ShellLogWriter.defaultMaxFileBytes,
    maxFiles: Int = ShellLogWriter.defaultMaxFiles,
    coalesceDelay: DispatchTimeInterval = .seconds(2)
  ) {
    precondition(capacity > 0 && (capacity & (capacity - 1)) == 0, "capacity must be power of two")
    precondition(maxFileBytes >= 1_024 && maxFiles >= 2)
    self.logFileURL = logFileURL
    self.capacity = capacity
    self.maxFileBytes = maxFileBytes
    self.maxFiles = maxFiles
    self.coalesceDelay = coalesceDelay
    self.sink = ShellLogFileSink(
      logFileURL: logFileURL, maxFileBytes: maxFileBytes, maxFiles: maxFiles)
    let preallocated = ContiguousArray<Slot>(repeating: Slot(), count: capacity)
    self.lock = OSAllocatedUnfairLock(initialState: RingState(slots: preallocated))
  }

  deinit {
    let pending = lock.withLock { state -> FlushHandle? in
      state.isClosed = true
      let handle = state.pendingFlush
      state.pendingFlush = nil
      return handle
    }
    pending?.item.cancel()
    sink.closeDescriptor()
  }

  /// Non-blocking MPSC enqueue (`< 500 ns`). Never blocks on disk I/O or full buffer.
  public func enqueue(level: Level, category: String, message: String) {
    let catInline = InlineText64(truncatingUTF8: category)
    let clampedMsg = Self.clampUTF8(message, maxBytes: Self.maxMessageUTF8Bytes)
    let epochMs = Self.currentEpochMs()

    enum ScheduleAction: Sendable {
      case none
      case coalesced(FlushHandle)
      case immediate(cancel: FlushHandle?)
    }

    let action: ScheduleAction = lock.withLock { state in
      guard !state.isClosed else { return .none }
      guard state.count < capacity else {
        state.droppedCount &+= 1
        return .none
      }
      let slotIndex = state.writeIndex
      state.slots[slotIndex] = Slot(
        epochMs: epochMs, level: level, category: catInline, message: clampedMsg)
      state.writeIndex = (slotIndex + 1) & (capacity - 1)
      state.count += 1

      if level == .fault || state.count >= Self.immediateFlushThreshold {
        let existing = state.pendingFlush
        state.pendingFlush = nil
        return .immediate(cancel: existing)
      }
      if state.pendingFlush == nil {
        let handle = FlushHandle(
          item: DispatchWorkItem(qos: .utility) { [weak self] in
            self?.drainAndWriteOnQueue()
          })
        state.pendingFlush = handle
        return .coalesced(handle)
      }
      return .none
    }

    switch action {
    case .none:
      break
    case .coalesced(let handle):
      ioQueue.asyncAfter(deadline: .now() + coalesceDelay, execute: handle.item)
    case .immediate(let cancelled):
      cancelled?.item.cancel()
      ioQueue.async { [weak self] in self?.drainAndWriteOnQueue() }
    }
  }

  /// Synchronously flushes queued entries within `timeout` (used before bundle export or app exit).
  @discardableResult
  public func flush(timeout: DispatchTimeInterval = .milliseconds(500)) -> Bool {
    let (isClosed, cancelled) = lock.withLock { state -> (Bool, FlushHandle?) in
      if state.isClosed { return (true, nil) }
      let handle = state.pendingFlush
      state.pendingFlush = nil
      return (false, handle)
    }
    guard !isClosed else { return true }
    cancelled?.item.cancel()
    let semaphore = DispatchSemaphore(value: 0)
    ioQueue.async { [weak self] in
      self?.drainAndWriteOnQueue(allowWhenClosed: false)
      semaphore.signal()
    }
    return semaphore.wait(timeout: .now() + timeout) == .success
  }

  /// Closes the active descriptor after draining remaining lines within `timeout` (`B30`).
  public func close(timeout: DispatchTimeInterval = .milliseconds(500)) {
    let (alreadyClosed, cancelled) = lock.withLock { state -> (Bool, FlushHandle?) in
      if state.isClosed { return (true, nil) }
      state.isClosed = true
      let handle = state.pendingFlush
      state.pendingFlush = nil
      return (false, handle)
    }
    cancelled?.item.cancel()
    guard !alreadyClosed else { return }

    let semaphore = DispatchSemaphore(value: 0)
    ioQueue.async { [self] in
      self.drainAndWriteOnQueue(allowWhenClosed: true)
      self.sink.closeDescriptor()
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + timeout)
  }

  var activeFileDescriptorForTesting: Int32 {
    sink.activeDescriptorForTesting
  }

  private func drainAndWriteOnQueue(allowWhenClosed: Bool = false) {
    var drained: [Slot] = []
    let dropped: UInt64 = lock.withLockUnchecked { state in
      guard allowWhenClosed || !state.isClosed else { return 0 }
      state.pendingFlush = nil
      guard state.count > 0 || state.droppedCount > 0 else { return 0 }
      drained.reserveCapacity(state.count)
      for _ in 0..<state.count {
        drained.append(state.slots[state.readIndex])
        state.slots[state.readIndex] = Slot()
        state.readIndex = (state.readIndex + 1) & (capacity - 1)
      }
      state.count = 0
      let overflow = state.droppedCount
      state.droppedCount = 0
      return overflow
    }
    guard !drained.isEmpty || dropped > 0 else { return }

    let encoder = JSONEncoder()
    var batch = Data()
    batch.reserveCapacity(drained.count * 160 + (dropped > 0 ? 128 : 0))

    for item in drained {
      let record = RecordPayload(
        ts: Self.isoTimestamp(epochMs: item.epochMs),
        level: item.level.rawValue,
        cat: item.category.stringValue,
        msg: item.message,
        dropped: nil)
      if let encoded = try? encoder.encode(record) {
        batch.append(encoded)
        batch.append(0x0A)
      }
    }

    if dropped > 0 {
      let overflowRecord = RecordPayload(
        ts: Self.isoTimestamp(epochMs: Self.currentEpochMs()),
        level: Level.warn.rawValue,
        cat: "diagnostics",
        msg: "shell_log_ring_overflow",
        dropped: dropped)
      if let encoded = try? encoder.encode(overflowRecord) {
        batch.append(encoded)
        batch.append(0x0A)
      }
    }

    sink.writeBatch(batch)
  }

  private static func currentEpochMs() -> Int64 {
    var tv = timeval()
    gettimeofday(&tv, nil)
    return Int64(tv.tv_sec) * 1_000 + Int64(tv.tv_usec / 1_000)
  }

  private static func clampUTF8(_ source: String, maxBytes: Int) -> String {
    guard source.utf8.count > maxBytes else { return source }
    return DiagnosticsScrubberRules.truncateUTF8(source, maxPrefixBytes: maxBytes - 3, suffix: "…")
  }

  private static func isoTimestamp(epochMs: Int64) -> String {
    let date = Date(timeIntervalSince1970: Double(epochMs) / 1_000.0)
    return date.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true))
  }
}
