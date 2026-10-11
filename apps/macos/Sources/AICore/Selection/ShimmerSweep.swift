/// The geometry and timing of running text's shimmer: a port of the page's `Shimmer`
/// (`packages/ui/src/components/ai-elements/shimmer.tsx`, `.ai-shimmer` in
/// `packages/ui/src/styles.css`) as the conversation's running rows use it, with its defaults, so
/// the shell's running text moves exactly like the app's: a foreground-coloured band sweeps left
/// to right across text in the muted colour, linearly, once every ``duration`` seconds, without
/// end.
///
/// The band is a horizontal gradient as wide as itself, transparent → foreground → transparent,
/// its half-width ``spreadPerCharacter`` points per character, and its centre travels from one
/// half-width before the text's leading edge to one half-width past its trailing edge, so it
/// clears the text at both ends of every sweep and the next starts from nothing. Here "the text"
/// is the ink actually drawn and the characters it shows: the page sizes an inline element that
/// never truncates, while a native label may truncate a long name, whose band would otherwise be
/// scaled to characters that are not shown.
///
/// Every sweep keeps time with one shared clock (``phase(at:)``), not with the moment it was
/// added: a sweep added again (its window briefly occluded, its label laid out anew or rebuilt)
/// resumes where the band is instead of starting over.
public struct ShimmerSweep: Equatable, Sendable {
  /// Seconds per sweep (the page's `duration` default).
  public static let duration = 2.0
  /// The band's half-width per character, in points (the page's `spread` default).
  public static let spreadPerCharacter = 2.0
  /// The band's half-width.
  public let spread: Double
  /// The gradient's stops across its width: where the band starts, peaks and ends.
  public static let locations: [Double] = [0, 0.5, 1]
  /// The gradient's centre as a sweep starts and as it ends, in the label's coordinates.
  public let startCenter: Double
  public let endCenter: Double

  /// The sweep across ink spanning `inkMinX` to `inkMaxX` points that shows `characters`
  /// characters (counted as ``characters(in:)`` does); nil when there is no ink or nothing shown.
  public init?(inkMinX: Double, inkMaxX: Double, characters: Int) {
    guard inkMinX.isFinite, inkMaxX.isFinite, inkMaxX > inkMinX, characters > 0 else { return nil }
    spread = Double(characters) * Self.spreadPerCharacter
    // The page's `background-position` from `-2 × spread` to `100% + 2 × spread`.
    startCenter = inkMinX - spread
    endCenter = inkMaxX + spread
  }

  /// The gradient's width: the band itself.
  public var bandWidth: Double { spread * 2 }

  /// The characters the band's spread scales with: UTF-16 code units, as the page's
  /// `children.length` counts them, so the same name gets the same band in both.
  public static func characters(in text: String) -> Int { text.utf16.count }

  /// How many of `characters` a label shows when only `shownWidth` of the text's full
  /// `fullWidth` fits (truncation): all of them when it fits, else the visible share.
  public static func shownCharacters(_ characters: Int, shownWidth: Double, fullWidth: Double)
    -> Int
  {
    guard fullWidth > shownWidth, fullWidth > 0 else { return characters }
    return Int((Double(characters) * shownWidth / fullWidth).rounded())
  }

  /// How far into its sweep the band is at `time` (seconds on a monotonic clock), from 0 up to
  /// ``duration``: the time modulo the duration, so sweeps added at different moments line up.
  public static func phase(at time: Double) -> Double {
    let phase = time.truncatingRemainder(dividingBy: duration)
    return phase < 0 ? phase + duration : phase
  }
}
