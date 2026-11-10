import AICore
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

/// JPEG key frames for asking about or attaching a recording (decision R11). The model learns
/// the recording from these frames and the context file; it cannot watch the movie.
nonisolated enum RecordingKeyframes {
  /// A key frame's long edge at most, in pixels: a 1080p recording keeps its size.
  static let maxLongEdge: CGFloat = 1920
  static let quality = 0.8
  /// How far from the asked moment a frame may come: an exact frame would decode every frame
  /// since the movie's last sync frame.
  static let tolerance = CMTime(value: 1, timescale: 10)

  /// Writes the key frames at `times` from `movie` into `folder` as JPEGs named for the
  /// recording (``RecordingFileNames/keyframe(startedAt:time:timeZone:)``), in order; a frame
  /// that could not be read or written is left out. Only one decoded image is held at a time;
  /// cancellation stops decoding and further encoding. The caller owns partial-file cleanup.
  @concurrent
  static func write(_ times: [Double], from movie: URL, startedAt: Date, into folder: URL) async
    -> [(time: Double, file: URL)]
  {
    guard !Task.isCancelled else { return [] }
    let source = RecordingFrameSource(movie: movie)
    var written: [(time: Double, file: URL)] = []
    var names: Set<String> = []
    for time in times.sorted() {
      guard !Task.isCancelled else { return [] }
      let frame = await source.image(at: time)
      guard !Task.isCancelled else { return [] }
      guard let image = frame else { continue }
      let name = RecordingFileNames.unique(
        RecordingFileNames.keyframe(startedAt: startedAt, time: time), isTaken: names.contains)
      let file = folder.appending(path: name)
      guard autoreleasepool(invoking: { jpeg(image, to: file) }) else { continue }
      guard !Task.isCancelled else { return [] }
      names.insert(name)
      written.append((time, file))
    }
    return written
  }

  private static func jpeg(_ image: CGImage, to file: URL) -> Bool {
    guard
      let destination = CGImageDestinationCreateWithURL(
        file as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { return false }
    CGImageDestinationAddImage(
      destination, image,
      [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(destination)
  }
}

/// Serializes cancellation with request registration. Calling the async image API after a
/// separate cancellation check would leave a gap in which cancelAll has no request to cancel.
private actor RecordingFrameSource {
  private let generator: AVAssetImageGenerator
  private var cancelled = false

  init(movie: URL) {
    generator = AVAssetImageGenerator(asset: AVURLAsset(url: movie))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(
      width: RecordingKeyframes.maxLongEdge, height: RecordingKeyframes.maxLongEdge)
    generator.requestedTimeToleranceBefore = RecordingKeyframes.tolerance
    generator.requestedTimeToleranceAfter = RecordingKeyframes.tolerance
  }

  func image(at seconds: Double) async -> CGImage? {
    await withTaskCancellationHandler {
      // The task may be cancelled while hopping here, before the queued cancel() runs.
      guard !Task.isCancelled, !cancelled else { return nil }
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
    cancelled = true
    generator.cancelAllCGImageGeneration()
  }
}
