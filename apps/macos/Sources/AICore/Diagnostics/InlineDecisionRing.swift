import Darwin
import Foundation
import os

/// Entry contract for fixed-capacity zero-allocation decision rings.
public protocol SequencedDecisionEntry: Sendable, Equatable {
  static var empty: Self { get }
  var seq: UInt32 { get set }
  var uptimeNs: UInt64 { get }
  var isAnomaly: Bool { get }
}

/// Immutable snapshot returned by ``InlineDecisionRing/snapshot()``.
public struct DecisionRingSnapshot<Entry: Sendable>: Sendable {
  public let capacity: Int
  public let totalRecorded: UInt64
  public let overwrittenCount: UInt64
  public let entries: [Entry]

  public init(capacity: Int, totalRecorded: UInt64, overwrittenCount: UInt64, entries: [Entry]) {
    self.capacity = capacity
    self.totalRecorded = totalRecorded
    self.overwrittenCount = overwrittenCount
    self.entries = entries
  }
}

/// Monotonic clock anchor converting `CLOCK_UPTIME_RAW` nanoseconds into UTC ISO-8601 strings
/// exclusively on slow export/report paths (zero `DateFormatter` calls on hot paths).
public struct MonotonicTimestampAnchor: Sendable {
  public let baseWallEpochMs: Int64
  public let baseUptimeNs: UInt64

  public static let shared = Self()

  public init(
    baseWallEpochMs: Int64 = Int64((Date().timeIntervalSince1970 * 1_000.0).rounded()),
    baseUptimeNs: UInt64 = Self.nowUptimeNs()
  ) {
    self.baseWallEpochMs = baseWallEpochMs
    self.baseUptimeNs = baseUptimeNs
  }

  @inline(__always)
  public static func nowUptimeNs() -> UInt64 {
    clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
  }

  public func iso8601String(forUptimeNs uptimeNs: UInt64) -> String {
    let deltaMs: Int64
    if uptimeNs >= baseUptimeNs {
      deltaMs = Int64((uptimeNs - baseUptimeNs) / 1_000_000)
    } else {
      deltaMs = -Int64((baseUptimeNs - uptimeNs) / 1_000_000)
    }
    let date = Date(timeIntervalSince1970: Double(baseWallEpochMs + deltaMs) / 1_000.0)
    return date.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true))
  }
}

/// Generic fixed-capacity lock-guarded ring buffer (`OSAllocatedUnfairLock` with kernel priority
/// inheritance). Preallocates `ContiguousArray<Entry>` outside the lock at initialization and
/// during snapshots so hot-path writes and reads never allocate inside the critical section.
public final class InlineDecisionRing<Entry: SequencedDecisionEntry>: Sendable {
  private struct State: Sendable {
    var buffer: ContiguousArray<Entry>
    var writeIndex = 0
    var count = 0
    var nextSeq: UInt32 = 1
    var totalRecorded: UInt64 = 0
  }

  public let capacity: Int
  private let lock: OSAllocatedUnfairLock<State>

  public init(capacity: Int = 64) {
    precondition(capacity > 0 && (capacity & (capacity - 1)) == 0, "capacity must be power of two")
    self.capacity = capacity
    let preallocated = ContiguousArray<Entry>(repeating: Entry.empty, count: capacity)
    self.lock = OSAllocatedUnfairLock(initialState: State(buffer: preallocated))
  }

  @discardableResult
  @inline(__always)
  public func append(_ entry: Entry) -> (slot: Int, seq: UInt32) {
    lock.withLock { state in
      var item = entry
      let seq = state.nextSeq
      let incremented = seq &+ 1
      state.nextSeq = incremented == 0 ? 1 : incremented
      item.seq = seq
      let slot = state.writeIndex
      state.buffer[slot] = item
      state.writeIndex = (slot + 1) & (capacity - 1)
      if state.count < capacity { state.count += 1 }
      state.totalRecorded &+= 1
      return (slot, seq)
    }
  }

  @discardableResult
  @inline(__always)
  public func record(_ entry: Entry) -> (slot: Int, seq: UInt32) {
    append(entry)
  }

  /// Mutates an existing slot in place only if it has not wrapped around since `expectedSeq`
  /// (used to complete 150ms selection debounce outcomes without duplicate ring entries).
  @discardableResult
  @inline(__always)
  public func update(slot: Int, expectedSeq: UInt32, _ mutate: (inout Entry) -> Void) -> Bool {
    guard slot >= 0 && slot < capacity else { return false }
    return lock.withLockUnchecked { state in
      guard state.buffer[slot].seq == expectedSeq else { return false }
      mutate(&state.buffer[slot])
      return true
    }
  }

  public func snapshot() -> DecisionRingSnapshot<Entry> {
    var copied = ContiguousArray<Entry>()
    copied.reserveCapacity(capacity)
    let meta = lock.withLockUnchecked { state -> (total: UInt64, count: Int) in
      let start = state.count == capacity ? state.writeIndex : 0
      for offset in 0..<state.count {
        copied.append(state.buffer[(start + offset) & (capacity - 1)])
      }
      return (state.totalRecorded, state.count)
    }
    let overwritten = meta.total > UInt64(meta.count) ? meta.total - UInt64(meta.count) : 0
    return DecisionRingSnapshot(
      capacity: capacity,
      totalRecorded: meta.total,
      overwrittenCount: overwritten,
      entries: Array(copied))
  }
}

/// Lightweight 8-byte AX probe telemetry returned alongside `SelectionProbe` (zero text/refs).
public struct SelectionProbeTrace: Sendable, Equatable, BitwiseCopyable {
  public var lastAxError: Int16 = 0
  public var elapsedUs: UInt16 = 0
  public var roleCode: UInt8 = 0
  public var webAttrsMask: UInt8 = 0
  public var busyMutexSkipped = false

  public static let empty = Self()

  public init(
    lastAxError: Int16 = 0, elapsedUs: UInt16 = 0, roleCode: UInt8 = 0,
    webAttrsMask: UInt8 = 0, busyMutexSkipped: Bool = false
  ) {
    self.lastAxError = lastAxError
    self.elapsedUs = elapsedUs
    self.roleCode = roleCode
    self.webAttrsMask = webAttrsMask
    self.busyMutexSkipped = busyMutexSkipped
  }
}

/// Compact bitmask for the 14 boolean gates of `SelectionDecisionEntry` (`flags: UInt64`).
public struct SelectionGateFlags: OptionSet, Sendable, Equatable, BitwiseCopyable {
  public let rawValue: UInt64
  public init(rawValue: UInt64) { self.rawValue = rawValue }

  public static let hadCgLocation = Self(rawValue: 1 << 0)
  public static let hadMouseDown = Self(rawValue: 1 << 1)
  public static let shiftHeld = Self(rawValue: 1 << 2)
  public static let mayHaveSelected = Self(rawValue: 1 << 3)
  public static let cellsOnly = Self(rawValue: 1 << 4)
  public static let heldAtPress = Self(rawValue: 1 << 5)
  public static let heldAtRelease = Self(rawValue: 1 << 6)
  public static let toggleListening = Self(rawValue: 1 << 7)
  public static let admitted = Self(rawValue: 1 << 8)
  public static let trusted = Self(rawValue: 1 << 9)
  public static let secureInput = Self(rawValue: 1 << 10)
  public static let hasBounds = Self(rawValue: 1 << 11)
  public static let shown = Self(rawValue: 1 << 12)
  public static let busyMutexSkipped = Self(rawValue: 1 << 13)
}

/// Ring 1 (`SelectionDecisionRing`): `stride == 120 <= 128` bytes, zero selected/clipboard text.
public struct SelectionDecisionEntry: SequencedDecisionEntry, BitwiseCopyable {
  public var uptimeNs: UInt64 = 0
  public var frontmostBundleId: InlineText64 = .empty
  public var flags: UInt64 = 0
  public var seq: UInt32 = 0
  public var frontmostPid: Int32 = 0
  public var dragDistanceDeciPt: UInt16 = 0
  public var attempt0AxError: Int16 = 0
  public var attempt0ElapsedUs: UInt16 = 0
  public var interruptedAfterMs: UInt16 = 0
  public var attempt1AxError: Int16 = 0
  public var attempt1ElapsedUs: UInt16 = 0
  public var clickCount: UInt8 = 0
  public var activationMode: UInt8 = 0
  public var appFilter: UInt8 = 0
  public var attempt0Outcome: UInt8 = 0
  public var attempt0Role: UInt8 = 0
  public var attempt0WebAttrs: UInt8 = 0
  public var debounceState: UInt8 = 0
  public var interruptedBy: UInt8 = 0
  public var attempt1Outcome: UInt8 = 0
  public var selectionLengthBucket: UInt8 = 0
  public var dropStage: UInt8 = 0

  public static let empty = Self()
  public init() {}
  public var isAnomaly: Bool {
    attempt0AxError != 0 || attempt1AxError != 0
      || (flags & SelectionGateFlags.secureInput.rawValue) != 0
  }
}

/// Ring 2 (`HotKeyDecisionRing`): `stride == 96 <= 96` bytes, zero typed key characters.
public struct HotKeyDecisionEntry: SequencedDecisionEntry, BitwiseCopyable {
  public var uptimeNs: UInt64 = 0
  public var subjectOrBundleId: InlineText64 = .empty
  public var seq: UInt32 = 0
  public var frontmostPid: Int32 = 0
  public var modifierFlagsMask: UInt32 = 0
  public var elapsedMs: UInt16 = 0
  public var tapDisabledCount: UInt16 = 0
  public var eventKind: UInt8 = 0
  public var outcome: UInt8 = 0
  public var flags: UInt8 = 0
  public var subjectIsBundleId = false

  public static let empty = Self()
  public init() {}
  public var isAnomaly: Bool { tapDisabledCount > 0 || outcome >= 2 }
}

/// Ring 3 (`CaptureAndArbiterRing`): `stride == 96 <= 96` bytes, coarse lifecycle only (0 pixels).
public struct CaptureAndArbiterEntry: SequencedDecisionEntry, BitwiseCopyable {
  public var uptimeNs: UInt64 = 0
  public var ownerSummary: InlineText64 = .empty
  public var seq: UInt32 = 0
  public var heldDurationMs: UInt32 = 0
  public var errorCode: Int32 = 0
  public var freezeMs: UInt16 = 0
  public var widthPx: UInt16 = 0
  public var heightPx: UInt16 = 0
  public var eventKind: UInt8 = 0
  public var outcome: UInt8 = 0
  public var resourceMask: UInt8 = 0
  public var displayCount: UInt8 = 0
  public var unmatchedDisplayCount: UInt8 = 0
  public var flags: UInt8 = 0

  public static let empty = Self()
  public init() {}
  public var isAnomaly: Bool { errorCode != 0 || heldDurationMs > 30_000 || outcome >= 2 }
}

/// Ring 4 (`RelayAndSupervisorRing`): `stride == 96 <= 128` bytes, low-frequency control transitions.
public struct RelayAndSupervisorEntry: SequencedDecisionEntry, BitwiseCopyable {
  public var uptimeNs: UInt64 = 0
  public var detail: InlineText64 = .empty
  public var seq: UInt32 = 0
  public var pid: Int32 = 0
  public var epoch: Int32 = 0
  public var terminationStatus: Int32 = 0
  public var httpOrWsCode: UInt16 = 0
  public var crashCount: UInt16 = 0
  public var subsystem: UInt8 = 0
  public var eventKind: UInt8 = 0
  public var outcome: UInt8 = 0
  public var flags: UInt8 = 0

  public static let empty = Self()
  public init() {}
  public var isAnomaly: Bool { outcome >= 2 || crashCount > 0 || httpOrWsCode >= 500 }
}

public typealias SelectionDecisionRing = InlineDecisionRing<SelectionDecisionEntry>
public typealias HotKeyDecisionRing = InlineDecisionRing<HotKeyDecisionEntry>
public typealias CaptureAndArbiterRing = InlineDecisionRing<CaptureAndArbiterEntry>
public typealias RelayAndSupervisorRing = InlineDecisionRing<RelayAndSupervisorEntry>
