import AICore
import AVFoundation

/// Adds a take's microphone files to its movie: one audio track holding every stretch at its
/// media time, silent in between, beside the movie's video and system audio. The samples are
/// copied, not re-encoded.
nonisolated enum RecordingMux {
  /// Writes `movie` plus `microphone` to `output` (an `.mp4` that must not exist yet).
  @concurrent
  static func combine(movie: URL, microphone: [RecordingAudioSegment], into output: URL)
    async throws(RecordingError)
  {
    do {
      let source = AVURLAsset(url: movie)
      let composition = AVMutableComposition()
      let duration = try await source.load(.duration)
      for track in try await source.load(.tracks) {
        guard
          let copy = composition.addMutableTrack(
            withMediaType: track.mediaType, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { continue }
        try copy.insertTimeRange(
          CMTimeRange(start: .zero, duration: duration), of: track, at: .zero)
        copy.preferredTransform = try await track.load(.preferredTransform)
      }
      if let voice = composition.addMutableTrack(
        withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
      {
        for segment in microphone.sorted(by: { $0.start < $1.start }) {
          let asset = AVURLAsset(url: segment.url)
          guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
            continue
          }
          let length = try await asset.load(.duration)
          // Stretches never overlap; one that would starts where the last ended.
          let at = max(
            CMTime(seconds: segment.start, preferredTimescale: 48_000), voice.timeRange.end)
          let room = duration - at
          guard room > .zero else { break }
          let range = CMTimeRange(start: .zero, duration: min(length, room))
          try voice.insertTimeRange(range, of: track, at: at)
        }
      }
      guard
        let export = AVAssetExportSession(
          asset: composition, presetName: AVAssetExportPresetPassthrough)
      else { throw RecordingError.writerFailed("The movie could not be combined.") }
      try await export.export(to: output, as: .mp4)
    } catch let error as RecordingError {
      throw error
    } catch {
      throw .writerFailed(error.localizedDescription)
    }
  }
}
