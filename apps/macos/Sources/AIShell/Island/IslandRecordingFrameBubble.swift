import AICore
import AVFoundation
import Observation

/// The timeline's hover frame on one surface, the card's or the lightbox's (the result preview's
/// direction D): while the pointer is over the filmstrip, a bubble above it shows the frame at
/// that moment and its time (``IslandRecordingFrameBubbleView``). The strip reports the pointer
/// (``show(_:x:stripTop:card:scale:)``) and hides it again when the pointer leaves, a handle is
/// dragged or the strip is scrubbed, since the player already shows that frame then.
///
/// The precise frame is made on demand from the movie, off the main actor, at the bubble's size
/// at the display's scale: one frame at a time, the newest moment asked for while one is being
/// made waiting for it and replacing any older wish, so the latest request wins and the work
/// never piles up behind the pointer. Until a frame near the moment arrives, the filmstrip's
/// nearest one stands in (``IslandRecordingCardModel/frame(at:)``); the bubble shows whichever of
/// the two is nearer. Each surface has its own bubble: the two never show at once, and their
/// sizes differ.
@Observable
final class IslandRecordingFrameBubble {
  /// The coordinate space each surface names at its root: the strip reports the pointer in it,
  /// and the bubble is drawn in it.
  nonisolated static let space = "recording.bubble"

  /// A frame made for the bubble and the moment it shows.
  struct Frame {
    let image: CGImage
    let time: Double
  }

  let size: IslandMetrics.RecordingBubbleSize
  /// The moment under the pointer; nil while the bubble is hidden.
  private(set) var time: Double?
  /// The pointer's x and the strip's top edge, in ``space``.
  private(set) var anchor = CGPoint.zero
  /// The latest precise frame made.
  private(set) var precise: Frame?

  @ObservationIgnored private var source: IslandRecordingFrameSource?
  /// The moment to make next, the newest asked for while a frame is being made.
  @ObservationIgnored private var wanted: Double?
  @ObservationIgnored private var making: Task<Void, Never>?

  init(_ size: IslandMetrics.RecordingBubbleSize) {
    self.size = size
  }

  /// The pointer is over the strip at moment `seconds`, at `x` in ``space`` over a strip whose
  /// top edge is at `stripTop`: the bubble shows there, and the frame for it is asked for at
  /// `scale` (the display's).
  func show(
    _ seconds: Double, x: Double, stripTop: Double, card: IslandRecordingCardModel,
    scale: Double
  ) {
    let point = CGPoint(x: x, y: stripTop)
    if anchor != point { anchor = point }
    if time != seconds { time = seconds }
    prepare(card.source, scale: scale)
    wanted = seconds
    make()
  }

  /// The pointer left the strip, or a drag on it began: the bubble hides and no frame waits.
  func hide() {
    if time != nil { time = nil }
    wanted = nil
  }

  /// The surface went (the lightbox closes): the bubble hides and a frame being made stops.
  func stop() {
    hide()
    making?.cancel()
    making = nil
  }

  /// A source for `recording` at the bubble's size at `scale`, made anew (and what the old one
  /// made dropped) when the recording or the scale changed.
  private func prepare(_ recording: RecordingCardSource, scale: Double) {
    let frame = size.frame(aspect: recording.aspect)
    let pixels = CGSize(width: frame.width * scale, height: frame.height * scale)
    if let source, source.movie == recording.movie, source.pixels == pixels { return }
    making?.cancel()
    making = nil
    precise = nil
    source = IslandRecordingFrameSource(movie: recording.movie, pixels: pixels)
  }

  /// Makes the frames wished for, one at a time, until none waits.
  private func make() {
    guard making == nil, let source else { return }
    making = Task { [weak self] in
      while let seconds = self?.next() {
        let image = await source.image(at: seconds)
        guard let self, !Task.isCancelled else { return }
        if let image { precise = Frame(image: image, time: seconds) }
      }
    }
  }

  /// The moment to make next, taken; nil (and the making done) when none waits.
  private func next() -> Double? {
    guard let seconds = wanted else {
      making = nil
      return nil
    }
    wanted = nil
    return seconds
  }
}

/// Makes the bubble's frames from the movie off the main actor: one generator, its frames fitted
/// to `pixels`, asked for one at a time (the bubble waits for each). A request cancelled with its
/// task cancels the generator's work for it, which ends at once with no frame.
private actor IslandRecordingFrameSource {
  nonisolated let movie: URL
  nonisolated let pixels: CGSize
  private let generator: AVAssetImageGenerator

  init(movie: URL, pixels: CGSize) {
    self.movie = movie
    self.pixels = pixels
    generator = AVAssetImageGenerator(asset: AVURLAsset(url: movie))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = pixels
    // The frame at the moment: within half a frame of a 30 fps movie either side.
    let tolerance = CMTime(value: 1, timescale: 60)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance
  }

  func image(at seconds: Double) async -> CGImage? {
    await withTaskCancellationHandler {
      // The task may be cancelled while hopping here, before the queued cancel runs.
      guard !Task.isCancelled else { return nil }
      let time = CMTime(seconds: max(0, seconds), preferredTimescale: 600)
      return await withCheckedContinuation { continuation in
        generator.generateCGImageAsynchronously(for: time) { image, _, _ in
          continuation.resume(returning: image)
        }
      }
    } onCancel: {
      Task { await self.cancel() }
    }
  }

  private func cancel() {
    generator.cancelAllCGImageGeneration()
  }
}
