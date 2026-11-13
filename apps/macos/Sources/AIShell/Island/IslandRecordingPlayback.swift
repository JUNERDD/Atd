import AICore
import AVFoundation
import AppKit

/// Plays the recording on the result card: one `AVPlayer` over the movie, which the card's
/// player view shows (``IslandRecordingVideo``). It plays the kept range only (its end is the
/// item's forward end), reports the playhead about thirty times a second while playing, and
/// shows a frame without moving the playhead for the card's previews (a hovered step, a dragged
/// handle). Precise seeks, so a step's frame is the one at its time.
final class IslandRecordingPlayback {
  let player: AVPlayer
  /// The playhead while playing, in seconds.
  var onTime: ((Double) -> Void)?
  /// Playback reached the end of the kept range and paused there.
  var onEnd: (() -> Void)?
  private var timeObserver: Any?
  private var endObserver: NSObjectProtocol?
  private var playGeneration = 0

  init(movie: URL) {
    let asset = AVURLAsset(
      url: movie, options: [AVURLAssetPreferPreciseDurationAndTimingKey: false])
    player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
    player.actionAtItemEnd = .pause
    let interval = CMTime(value: 1, timescale: 30)
    timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) {
      [weak self] time in
      MainActor.assumeIsolated {
        guard let self, self.player.rate != 0 else { return }
        self.onTime?(time.seconds)
      }
    }
    endObserver = NotificationCenter.default.addObserver(
      forName: AVPlayerItem.didPlayToEndTimeNotification, object: player.currentItem,
      queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.onEnd?() } }
  }

  /// Plays from `start` to `end`, seconds.
  func play(from start: Double, until end: Double) {
    pause()
    let generation = playGeneration
    player.currentItem?.forwardPlaybackEndTime = Self.time(end)
    player.seek(to: Self.time(start), toleranceBefore: .zero, toleranceAfter: .zero) {
      [weak self] finished in
      guard finished else { return }
      MainActor.assumeIsolated {
        guard let self, self.playGeneration == generation else { return }
        self.player.play()
      }
    }
  }

  func pause() {
    // A finished seek may already have queued its completion when it is cancelled.
    playGeneration &+= 1
    player.pause()
    player.currentItem?.cancelPendingSeeks()
  }

  /// Shows the frame at `seconds` (the playhead moved, or a preview): playback pauses there.
  func show(_ seconds: Double) {
    pause()
    player.seek(to: Self.time(seconds), toleranceBefore: .zero, toleranceAfter: .zero)
  }

  /// Stops for good: the card is gone or shows another recording.
  func close() {
    pause()
    if let timeObserver { player.removeTimeObserver(timeObserver) }
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    timeObserver = nil
    endObserver = nil
  }

  private static func time(_ seconds: Double) -> CMTime {
    CMTime(seconds: max(seconds, 0), preferredTimescale: 600)
  }
}

/// Makes the filmstrip's frames from the movie off the main thread: `count` frames, each the
/// middle of an equal share of the recording, `height` points tall at `scale`.
enum IslandRecordingFrames {
  @concurrent
  static func make(
    movie: URL, duration: Double, count: Int, height: Double, aspect: Double, scale: Double
  ) async -> [Int: CGImage] {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: movie))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: height * aspect * scale, height: height * scale)
    let tolerance = CMTime(seconds: duration / Double(max(count, 1)) / 2, preferredTimescale: 600)
    generator.requestedTimeToleranceBefore = tolerance
    generator.requestedTimeToleranceAfter = tolerance
    var frames: [Int: CGImage] = [:]
    for index in 0..<count {
      let seconds = (Double(index) + 0.5) / Double(count) * duration
      let time = CMTime(seconds: seconds, preferredTimescale: 600)
      guard !Task.isCancelled else { break }
      if let image = try? await generator.image(at: time).image { frames[index] = image }
    }
    return frames
  }
}
