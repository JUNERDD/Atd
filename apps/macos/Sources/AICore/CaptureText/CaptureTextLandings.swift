import Foundation

/// The versions of one run's answer as they went onto the image: for each version that landed,
/// what it put there and which annotations each of its items drew. The image is the source of
/// truth for the version a run shows: undo and redo bring an earlier state of the image back
/// whole, annotations and all, so a run asks which of its versions the image holds now
/// (``version(in:)``) and follows it, rather than landing that version again. A run keeps one
/// (``CaptureTextRun/landings``).
public struct CaptureTextLandings: Equatable, Sendable {
  /// One version as it landed.
  public struct Landing: Equatable, Sendable {
    public let lead: String
    public let items: [CaptureTextRun.Item]
    /// The annotations each item drew, by its index in ``items``.
    public let applied: [Int: [UUID]]

    /// Every annotation the version drew.
    var ids: Set<UUID> { Set(applied.values.joined()) }
  }

  private var landings: [Int: Landing] = [:]
  /// The version the run has on the image now; nil before its first version landed.
  public private(set) var current: Int?

  public init() {}

  /// Version `version` as it last landed.
  public subscript(version: Int) -> Landing? { landings[version] }

  /// Version `version` landed as `landing` (again, when it had been taken off): it is the one on
  /// the image now.
  mutating func record(_ version: Int, _ landing: Landing) {
    landings[version] = landing
    current = version
  }

  /// The run follows version `version`, which an undo or a redo brought back onto the image.
  mutating func follow(_ version: Int) {
    guard landings[version] != nil else { return }
    current = version
  }

  /// No version of the run stands on the image any more.
  mutating func clearCurrent() {
    current = nil
  }

  /// The landed version other than ``current`` of which `present` (the annotations on the image)
  /// holds the most annotations, the newest on a tie; nil when none of theirs is there.
  func version(in present: Set<UUID>) -> Int? {
    var found: (version: Int, kept: Int)?
    for (version, landing) in landings where version != current {
      let kept = landing.ids.intersection(present).count
      guard kept > 0 else { continue }
      if let best = found, best.kept > kept || (best.kept == kept && best.version > version) {
        continue
      }
      found = (version, kept)
    }
    return found?.version
  }
}
