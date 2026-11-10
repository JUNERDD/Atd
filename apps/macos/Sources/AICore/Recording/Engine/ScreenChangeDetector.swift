import Foundation

/// Finds the moments a recorded region changes from coarse brightness signatures of its frames
/// (decision R11). A change is marked once the screen settles again, so scrolling or an
/// animation makes one mark when it ends rather than one per frame, and the mark points at the
/// frame that shows its outcome. Content that never settles (a playing video) makes none.
public struct ScreenChangeDetector: Sendable {
  /// A frame reduced to a grid of mean brightness values (0…255), row by row.
  public struct Signature: Equatable, Sendable {
    public var columns: Int
    public var rows: Int
    public var values: [UInt8]

    public init(columns: Int, rows: Int, values: [UInt8]) {
      self.columns = columns
      self.rows = rows
      self.values = values
    }

    /// The share of cells whose brightness differs from `other`'s by more than `tolerance`; 1
    /// when the grids do not match.
    public func difference(from other: Signature, tolerance: Int) -> Double {
      guard values.count == other.values.count, !values.isEmpty else { return 1 }
      let changed = zip(values, other.values).count { abs(Int($0) - Int($1)) > tolerance }
      return Double(changed) / Double(values.count)
    }
  }

  /// The grid a signature is taken at, and how often (seconds of media time).
  public static let columns = 32
  public static let rows = 18
  public static let interval = 0.25
  /// A cell changed when its brightness moved by more than this.
  static let cellTolerance = 18
  /// The share of cells that makes a change against the last settled frame.
  static let changeThreshold = 0.04
  /// Between two consecutive signatures, at most this share may differ for the screen to count
  /// as still.
  static let stillThreshold = 0.01
  /// How long the screen has to stay still for a change to settle.
  static let settleTime = 0.5

  private var reference: Signature?
  private var previous: Signature?
  /// When the change under way began, and since when the screen has been still.
  private var changeStart: Double?
  private var stillSince: Double?

  public init() {}

  /// Takes the signature of the frame at media `time` (in order); answers a change once one
  /// settled. The first signature only becomes the reference.
  public mutating func observe(_ signature: Signature, at time: Double)
    -> RecordingScreenChange?
  {
    defer { previous = signature }
    guard let reference else {
      self.reference = signature
      return nil
    }
    let still =
      previous.map {
        signature.difference(from: $0, tolerance: Self.cellTolerance) <= Self.stillThreshold
      } ?? true
    if changeStart == nil {
      guard
        signature.difference(from: reference, tolerance: Self.cellTolerance)
          >= Self.changeThreshold
      else { return nil }
      changeStart = time
      stillSince = still ? time : nil
      return nil
    }
    guard still else {
      stillSince = nil
      return nil
    }
    let since = stillSince ?? time
    stillSince = since
    guard time - since >= Self.settleTime, let start = changeStart else { return nil }
    changeStart = nil
    stillSince = nil
    self.reference = signature
    let fraction = signature.difference(from: reference, tolerance: Self.cellTolerance)
    // Back where it was (a menu opened and closed): nothing changed.
    guard fraction >= Self.changeThreshold else { return nil }
    return RecordingScreenChange(time: start, settled: since, fraction: fraction)
  }

  /// Ends the take: a change still under way counts when the last signature differs from the
  /// last settled one, settled at `lastTime`, the media time of that signature. ScreenCaptureKit
  /// sends no new frame while the screen is still, so a change near the end may never have been
  /// seen settling.
  public mutating func finish(lastTime: Double) -> RecordingScreenChange? {
    defer { changeStart = nil }
    guard let start = changeStart, let reference, let previous else { return nil }
    let fraction = previous.difference(from: reference, tolerance: Self.cellTolerance)
    guard fraction >= Self.changeThreshold else { return nil }
    return RecordingScreenChange(
      time: start, settled: max(start, stillSince ?? lastTime), fraction: fraction)
  }
}
