import Foundation

/// A processed take: what the result card shows and what asking or attaching sends (decisions
/// R9, R11). It owns the take's folder, as the take did.
public struct RecordingResult: Equatable, Sendable {
  public var take: RecordingTake
  /// The app the recording shows, for the title row.
  public var app: String?
  /// Every step, in time order (``RecordingSteps``).
  public var steps: [RecordingStep]
  /// The moments worth a key frame: the start, each step's frame time and the end, at least
  /// ``RecordingKeyframePlan/minimumSpacing`` apart.
  public var keyframeTimes: [Double]
  public var narration: RecordingNarration

  public init(
    take: RecordingTake, app: String?, steps: [RecordingStep], keyframeTimes: [Double],
    narration: RecordingNarration
  ) {
    self.take = take
    self.app = app
    self.steps = steps
    self.keyframeTimes = keyframeTimes
    self.narration = narration
  }

  public var movie: URL { take.movie }
  public var duration: Double { take.duration }
  /// The whole take, which is also the range before any trim.
  public var fullRange: ClosedRange<Double> { 0...max(0, take.duration) }
}

/// Which moments of a recording become key frames: the model cannot watch the video, so it
/// learns the recording from these images and the context file (decision R11).
public enum RecordingKeyframePlan {
  /// Two key frames closer than this show the same screen.
  public static let minimumSpacing = 0.5
  /// A frame this close to the end still has content (the last one may be blank).
  static let endInset = 0.05

  /// The start, every step's frame time and the end, in order, dropping any closer than
  /// ``minimumSpacing`` to the one kept before it (the end always stays).
  public static func candidates(steps: [RecordingStep], duration: Double) -> [Double] {
    let end = max(0, duration - endInset)
    let times = ([0] + steps.map(\.frameTime)).map { min(max(0, $0), end) }.sorted()
    var kept: [Double] = []
    for time in times where kept.last.map({ time - $0 >= minimumSpacing }) ?? true {
      kept.append(time)
    }
    if let last = kept.last, end - last < minimumSpacing, kept.count > 1 { kept.removeLast() }
    if kept.last != end { kept.append(end) }
    return kept
  }

  /// At most `limit` of `candidates` for files about `range`: the frames inside it, with its two
  /// ends standing in when no candidate is near them, spread evenly over the list when there are
  /// more than `limit`, the first and last always kept.
  public static func select(_ candidates: [Double], in range: ClosedRange<Double>, limit: Int)
    -> [Double]
  {
    guard limit > 0 else { return [] }
    var inside = candidates.filter { range.contains($0) }
    if inside.first.map({ $0 - range.lowerBound >= minimumSpacing }) ?? true {
      inside.insert(range.lowerBound, at: 0)
    }
    if let last = inside.last, range.upperBound - last >= minimumSpacing {
      inside.append(max(range.lowerBound, range.upperBound - endInset))
    }
    guard inside.count > limit else { return inside }
    guard limit > 1 else { return [inside[0]] }
    let step = Double(inside.count - 1) / Double(limit - 1)
    return (0..<limit).map { inside[Int((Double($0) * step).rounded())] }
  }
}

/// The attachment budget a recording's files must fit (packages/agent-contracts
/// `MAX_ATTACHMENTS`, `MAX_ATTACHMENT_BYTES`): the movie and the context file leave room for
/// ``maxKeyframes`` images in one message.
public enum RecordingAttachmentRules {
  public static let maxKeyframes = AttachmentRules.maxPathsPerImport - 2
  /// The service refuses a larger file.
  public static let maxMovieBytes = 64 * 1024 * 1024
  /// Below this the video is not worth re-encoding to: it is omitted instead.
  public static let minimumVideoBitRate = 250_000
  /// What one AAC track costs at most; audio is copied, not re-encoded.
  static let audioBitRate = 128_000
  /// Container and bit-rate overshoot room.
  static let headroom = 0.85
  /// Fewer bits per pixel per frame than this blur text, so the frame shrinks instead, down to
  /// ``minimumLongSide``.
  static let minimumBitsPerPixel = 0.04
  static let minimumLongSide = 640

  /// A movie re-encoded to fit ``maxMovieBytes``: its pixels and video bit rate.
  public struct Reencode: Equatable, Sendable {
    public var pixelWidth: Int
    public var pixelHeight: Int
    public var bitRate: Int
  }

  /// How `duration` seconds of a `pixelWidth` × `pixelHeight` movie at `fps` with `audioTracks`
  /// audio tracks fit ``maxMovieBytes``: the video's bit rate for the bytes left, at the same
  /// size while that leaves ``minimumBitsPerPixel``, else at a smaller size that does (never a
  /// long side under ``minimumLongSide``, both sides even). Nil when the rate would fall under
  /// ``minimumVideoBitRate``: the movie is then left out.
  public static func reencode(
    duration: Double, pixelWidth: Int, pixelHeight: Int, fps: Double, audioTracks: Int
  ) -> Reencode? {
    guard duration > 0, pixelWidth > 1, pixelHeight > 1 else { return nil }
    let total = Double(maxMovieBytes) * 8 * headroom / duration
    let rate = total - Double(audioTracks * audioBitRate)
    guard rate >= Double(minimumVideoBitRate) else { return nil }
    let frames = max(1, fps)
    let pixels = Double(pixelWidth * pixelHeight)
    let long = Double(max(pixelWidth, pixelHeight))
    var factor = min(1, (rate / (minimumBitsPerPixel * frames * pixels)).squareRoot())
    factor = max(factor, min(1, Double(minimumLongSide) / long))
    let even = { (value: Double) in max(2, Int(value.rounded(.down)) & ~1) }
    return Reencode(
      pixelWidth: even(Double(pixelWidth) * factor),
      pixelHeight: even(Double(pixelHeight) * factor),
      bitRate: Int(rate))
  }
}
