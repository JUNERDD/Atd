/// Swift → page delivery schedule for one web view (spike S6): at most one
/// `callAsyncJavaScript` in flight. A frame that arrives while nothing is in flight is delivered
/// on the next main-queue turn, so frames arriving in the same turn share a call; frames that
/// arrive while a call is in flight wait, and its completion sends the whole backlog as one
/// batch. S6 measured this at 8.1 ms p99 for a 2000-frame burst with 2 ms of JS work per batch,
/// against 141 ms when batching only per run-loop turn, with no frame lost.
///
/// The queue holds no timers or web views: the owner performs the returned actions.
public struct FrameDeliveryQueue<Frame: Sendable>: Sendable {
  /// A batch stops growing once it holds this many bytes, so one call never carries an
  /// unbounded backlog; its first frame always goes, however large.
  public static var defaultBatchByteLimit: Int { 4 * 1024 * 1024 }

  public enum Action: Equatable, Sendable {
    case none
    /// Call ``takeBatch()`` on the next main-queue turn (after ``enqueue(_:bytes:)``), or right
    /// away (after ``completed()``), and deliver what it returns.
    case flush
  }

  public let batchByteLimit: Int
  private var backlog: [(frame: Frame, bytes: Int)] = []
  private var head = 0
  private var inFlight = false
  private var flushPending = false

  public init(batchByteLimit: Int = Self.defaultBatchByteLimit) {
    self.batchByteLimit = max(1, batchByteLimit)
  }

  /// Frames waiting for a call.
  public var pendingCount: Int { backlog.count - head }
  public var isInFlight: Bool { inFlight }

  public mutating func enqueue(_ frame: Frame, bytes: Int) -> Action {
    backlog.append((frame, max(0, bytes)))
    guard !inFlight, !flushPending else { return .none }
    flushPending = true
    return .flush
  }

  /// The next batch to deliver, in arrival order. A non-empty batch marks a call in flight; the
  /// owner must report its end with ``completed()``, whether it succeeded or failed.
  public mutating func takeBatch() -> [Frame] {
    flushPending = false
    guard !inFlight, head < backlog.count else { return [] }
    var batch: [Frame] = []
    var size = 0
    while head < backlog.count {
      let next = backlog[head]
      if !batch.isEmpty, size + next.bytes > batchByteLimit { break }
      batch.append(next.frame)
      size += next.bytes
      head += 1
    }
    compact()
    inFlight = true
    return batch
  }

  /// The call in flight ended. Returns ``Action/flush`` when frames are waiting.
  public mutating func completed() -> Action {
    inFlight = false
    guard head < backlog.count, !flushPending else { return .none }
    flushPending = true
    return .flush
  }

  /// Drops every waiting frame (the page that would receive them is gone). A call in flight
  /// still has to report ``completed()``.
  public mutating func discardPending() {
    backlog.removeAll()
    head = 0
  }

  private mutating func compact() {
    if head == backlog.count {
      backlog.removeAll(keepingCapacity: true)
      head = 0
    } else if head > 1024, head * 2 > backlog.count {
      backlog.removeFirst(head)
      head = 0
    }
  }
}
