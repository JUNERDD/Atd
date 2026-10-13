/// When the typing trace (``InsertionTrace``) asks the field where text landed. The write never
/// waits for the trace, and the trace's reads share the field with the write's caret reads, so at
/// most one read runs at a time (it ends before ``readDone()``), and runs that go in meanwhile merge
/// into the next read (``InsertionTrace/Run/merge(_:)``): a slow field gets fewer, larger marks
/// rather than a slower write. Once the write ended (``finish()``) and the reads still due are
/// done, the trace closes, exactly once.
public struct InsertionTraceQueue: Equatable, Sendable {
  /// What the trace does next.
  public enum Step: Equatable, Sendable {
    /// Read the marks of this run, then report ``InsertionTraceQueue/readDone()``.
    case read(InsertionTrace.Run)
    /// Fade the trace out: the write ended and nothing is left to draw.
    case close
    /// Nothing to do until the next event.
    case wait
  }

  private var pending: InsertionTrace.Run?
  private var reading = false
  private var finished = false
  private var closed = false

  public init() {}

  /// `run` went in.
  public mutating func add(_ run: InsertionTrace.Run) -> Step {
    guard !closed else { return .wait }
    if var merged = pending {
      merged.merge(run)
      pending = merged
    } else {
      pending = run
    }
    return next()
  }

  /// The read the last ``Step/read(_:)`` asked for ended, with marks or without.
  public mutating func readDone() -> Step {
    reading = false
    return next()
  }

  /// The write ended, typed out or interrupted.
  public mutating func finish() -> Step {
    finished = true
    return next()
  }

  private mutating func next() -> Step {
    guard !reading, !closed else { return .wait }
    if let run = pending {
      pending = nil
      reading = true
      return .read(run)
    }
    guard finished else { return .wait }
    closed = true
    return .close
  }
}
