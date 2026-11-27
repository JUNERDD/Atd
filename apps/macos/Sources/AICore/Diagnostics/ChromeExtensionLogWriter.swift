import AIChromeChannelKit
import CryptoKit
import Darwin
import Dispatch
import Foundation
import os

/// Asynchronous, non-blocking flight recorder persisting paired Atd for Chrome `diag.batch`
/// entries as flat size-rotated JSONL (`1 MiB × 3`, `256`-slot MPSC ring, `2s` coalesced flush).
///
/// Writes strictly flat JSON objects (no JSON embedded inside `msg`) so ``DiagnosticsScrubber``
/// `.jsonl` leaf mode runs fast without nested JSON re-parsing.
public final class ChromeExtensionLogWriter: Sendable {
  /// Thread-safe wrapper for `DispatchWorkItem` guarded by `OSAllocatedUnfairLock`.
  private struct FlushHandle: @unchecked Sendable {
    let item: DispatchWorkItem
  }

  private struct Slot: Sendable {
    var epochMs: Int64 = 0
    var profile = ""
    var entry: ChromeDiagEntry?
    var dropped: UInt64?
    var droppedExtTs: String?
  }

  private struct RingState: Sendable {
    var slots: ContiguousArray<Slot>
    var readIndex = 0
    var writeIndex = 0
    var count = 0
    var droppedCount: UInt64 = 0
    var overflowProfile = "shell"
    var pendingFlush: FlushHandle?
    var isClosed = false
  }

  private struct RecordPayload: Encodable {
    let ts: String
    let extTs: String
    let level: String
    let surface: String
    let cat: String
    let profile: String
    let code: String?
    let runId: String?
    let tabId: Int?
    let targetId: String?
    let cdpSession: String?
    let origin: String?
    let msg: String
    let seq: Int?
    let dropped: UInt64?
  }

  public static let defaultCapacity = 256
  public static let immediateFlushThreshold = 64
  public static let defaultMaxFileBytes = 1_048_576  // 1 MiB
  public static let defaultMaxFiles = 3  // 1 MiB × 3 = 3 MiB
  public static let maxMessageUTF8Bytes = 384

  public let logFileURL: URL
  public let capacity: Int
  public let maxFileBytes: Int
  public let maxFiles: Int
  public let coalesceDelay: DispatchTimeInterval

  private let lock: OSAllocatedUnfairLock<RingState>
  private let ioQueue = DispatchQueue(
    label: "com.junerdd.ai.chrome-extension-log-writer", qos: .utility)
  private let sink: ShellLogFileSink

  /// Resolves `<dataDirectory>/logs/chrome-extension.jsonl` in Development vs
  /// `~/Library/Logs/AI/chrome-extension.jsonl` in Release.
  public static func defaultLogURL(
    dataDirectory: URL,
    homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
    isDevelopment: Bool
  ) -> URL {
    if isDevelopment {
      return dataDirectory.appending(
        path: "logs/chrome-extension.jsonl", directoryHint: .notDirectory)
    }
    return homeDirectory.appending(
      path: "Library/Logs/AI/chrome-extension.jsonl", directoryHint: .notDirectory)
  }

  /// Stable 8-character lowercase hex SHA-256 prefix of an extension `installationId`.
  public static func profileHash(for installationId: String) -> String {
    SHA256.hash(data: Data(installationId.utf8)).prefix(4).map { String(format: "%02x", $0) }
      .joined()
  }

  public init(
    logFileURL: URL,
    capacity: Int = ChromeExtensionLogWriter.defaultCapacity,
    maxFileBytes: Int = ChromeExtensionLogWriter.defaultMaxFileBytes,
    maxFiles: Int = ChromeExtensionLogWriter.defaultMaxFiles,
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

  /// Non-blocking MPSC enqueue for a batch of extension entries and optional dropped count.
  public func enqueue(_ entries: [ChromeDiagEntry], profile: String, dropped: Int = 0) {
    guard !entries.isEmpty || dropped > 0 else { return }
    let epochMs = Self.currentEpochMs()
    let cleanProfile = Self.singleLine(profile, maxBytes: 16)

    enum ScheduleAction: Sendable {
      case none
      case coalesced(FlushHandle)
      case immediate(cancel: FlushHandle?)
    }

    let action: ScheduleAction = lock.withLock { state in
      guard !state.isClosed else { return .none }
      func push(_ slot: Slot) {
        if state.count < capacity {
          let idx = state.writeIndex
          state.slots[idx] = slot
          state.writeIndex = (idx + 1) & (capacity - 1)
          state.count += 1
        } else {
          state.droppedCount &+= slot.dropped ?? 1
          state.overflowProfile = cleanProfile
        }
      }
      if dropped > 0 {
        push(
          Slot(
            epochMs: epochMs, profile: cleanProfile, entry: nil, dropped: UInt64(dropped),
            droppedExtTs: entries.first?.extTs))
      }
      for entry in entries {
        push(Slot(epochMs: epochMs, profile: cleanProfile, entry: entry))
      }

      if state.count >= Self.immediateFlushThreshold {
        let existing = state.pendingFlush
        state.pendingFlush = nil
        return .immediate(cancel: existing)
      }
      if state.pendingFlush == nil && (state.count > 0 || state.droppedCount > 0) {
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
    case .none: break
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

  /// Closes the active descriptor after draining remaining lines within `timeout`.
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
    let (dropped, overflowProfile): (UInt64, String) = lock.withLockUnchecked { state in
      guard allowWhenClosed || !state.isClosed else { return (0, "shell") }
      state.pendingFlush = nil
      guard state.count > 0 || state.droppedCount > 0 else { return (0, "shell") }
      drained.reserveCapacity(state.count)
      for _ in 0..<state.count {
        drained.append(state.slots[state.readIndex])
        state.slots[state.readIndex] = Slot()
        state.readIndex = (state.readIndex + 1) & (capacity - 1)
      }
      state.count = 0
      let overflow = state.droppedCount
      let profile = state.overflowProfile
      state.droppedCount = 0
      return (overflow, profile)
    }
    guard !drained.isEmpty || dropped > 0 else { return }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    var batch = Data()
    batch.reserveCapacity(drained.count * 256 + (dropped > 0 ? 192 : 0))

    for item in drained {
      if let encoded = try? encoder.encode(Self.makePayload(for: item)) {
        batch.append(encoded)
        batch.append(0x0A)
      }
    }
    if dropped > 0 {
      let nowTs = Self.isoTimestamp(epochMs: Self.currentEpochMs())
      let overflowRecord = RecordPayload(
        ts: nowTs, extTs: nowTs, level: ChromeDiagLevel.warn.rawValue,
        surface: ChromeDiagSurface.background.rawValue, cat: "diagnostics",
        profile: overflowProfile, code: nil, runId: nil, tabId: nil, targetId: nil,
        cdpSession: nil, origin: nil, msg: "chrome_extension_log_ring_overflow",
        seq: nil, dropped: dropped)
      if let encoded = try? encoder.encode(overflowRecord) {
        batch.append(encoded)
        batch.append(0x0A)
      }
    }
    sink.writeBatch(batch)
  }

  private static func makePayload(for slot: Slot) -> RecordPayload {
    let ts = isoTimestamp(epochMs: slot.epochMs)
    if let entry = slot.entry {
      return RecordPayload(
        ts: ts, extTs: singleLine(entry.extTs, maxBytes: 64), level: entry.level.rawValue,
        surface: entry.surface.rawValue, cat: singleLine(entry.cat, maxBytes: 64),
        profile: slot.profile, code: entry.code.map { singleLine($0, maxBytes: 64) },
        runId: entry.runId.map { singleLine($0, maxBytes: 256) }, tabId: entry.tabId,
        targetId: entry.targetId.map { singleLine($0, maxBytes: 128) },
        cdpSession: entry.cdpSession.map { singleLine($0, maxBytes: 128) },
        origin: entry.origin.map { singleLine($0, maxBytes: 256) },
        msg: singleLine(entry.msg, maxBytes: maxMessageUTF8Bytes), seq: entry.seq, dropped: nil)
    }
    let extTs = slot.droppedExtTs.map { singleLine($0, maxBytes: 64) } ?? ts
    return RecordPayload(
      ts: ts, extTs: extTs, level: ChromeDiagLevel.warn.rawValue,
      surface: ChromeDiagSurface.background.rawValue, cat: "diagnostics", profile: slot.profile,
      code: nil, runId: nil, tabId: nil, targetId: nil, cdpSession: nil, origin: nil,
      msg: "chrome_extension_diag_dropped", seq: nil, dropped: slot.dropped)
  }

  private static func currentEpochMs() -> Int64 {
    var tv = timeval()
    gettimeofday(&tv, nil)
    return Int64(tv.tv_sec) * 1_000 + Int64(tv.tv_usec / 1_000)
  }

  private static func singleLine(_ source: String, maxBytes: Int) -> String {
    let collapsed =
      source.contains("\n") || source.contains("\r")
      ? source.replacingOccurrences(of: "\r\n", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: "\r", with: " ")
      : source
    guard collapsed.utf8.count > maxBytes else { return collapsed }
    return DiagnosticsScrubberRules.truncateUTF8(
      collapsed, maxPrefixBytes: max(0, maxBytes - 3), suffix: "…")
  }

  private static func isoTimestamp(epochMs: Int64) -> String {
    DiagnosticsTimestamp.iso8601UTC(Date(timeIntervalSince1970: Double(epochMs) / 1_000.0))
  }
}
