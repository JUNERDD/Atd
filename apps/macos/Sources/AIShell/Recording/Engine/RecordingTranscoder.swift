import AICore
import AVFoundation

/// Re-encodes a range of a recording's movie to fit the attachment limit
/// (``RecordingAttachmentRules/reencode(duration:pixelWidth:pixelHeight:fps:audioTracks:)``):
/// the video at the bit rate the limit leaves, smaller when that rate would blur text, and the
/// audio tracks copied as they are.
nonisolated enum RecordingTranscoder {
  /// Writes `range` of `movie` to `output` (an `.mp4` that must not exist yet); false, writing
  /// nothing, when no bit rate worth keeping fits.
  @concurrent
  static func fit(_ movie: URL, range: CMTimeRange, to output: URL) async throws(RecordingError)
    -> Bool
  {
    do {
      let asset = AVURLAsset(url: movie)
      guard let video = try await asset.loadTracks(withMediaType: .video).first else {
        throw RecordingError.exportFailed("The recording has no video.")
      }
      let audio = try await asset.loadTracks(withMediaType: .audio)
      let size = try await video.load(.naturalSize)
      let fps = Double(try await video.load(.nominalFrameRate))
      guard
        let plan = RecordingAttachmentRules.reencode(
          duration: range.duration.seconds, pixelWidth: Int(size.width),
          pixelHeight: Int(size.height), fps: fps > 0 ? fps : 30, audioTracks: audio.count)
      else { return false }
      let reader = try AVAssetReader(asset: asset)
      reader.timeRange = range
      let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
      let frames = AVAssetReaderTrackOutput(
        track: video,
        outputSettings: [
          kCVPixelBufferPixelFormatTypeKey as String:
            kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        ])
      frames.alwaysCopiesSampleData = false
      reader.add(frames)
      let encoder = AVAssetWriterInput(mediaType: .video, outputSettings: settings(plan))
      writer.add(encoder)
      var pairs: [(output: AVAssetReaderOutput, input: AVAssetWriterInput)] = [(frames, encoder)]
      for track in audio {
        let samples = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        let format = try await track.load(.formatDescriptions).first
        let copy = AVAssetWriterInput(
          mediaType: .audio, outputSettings: nil, sourceFormatHint: format)
        reader.add(samples)
        writer.add(copy)
        pairs.append((samples, copy))
      }
      guard reader.startReading(), writer.startWriting() else {
        throw RecordingError.exportFailed(
          (reader.error ?? writer.error)?.localizedDescription ?? "The recording could not be read."
        )
      }
      writer.startSession(atSourceTime: range.start)
      try await pump(pairs, reader: reader, writer: writer)
      await writer.finishWriting()
      guard writer.status == .completed else {
        throw RecordingError.exportFailed(writer.error?.localizedDescription ?? "Not finished.")
      }
      return true
    } catch let error as RecordingError {
      try? FileManager.default.removeItem(at: output)
      throw error
    } catch {
      try? FileManager.default.removeItem(at: output)
      throw .exportFailed(error.localizedDescription)
    }
  }

  /// Moves every track's samples from the reader to the writer, feeding whichever input is
  /// ready (the writer interleaves tracks and stalls one until another catches up).
  private static func pump(
    _ pairs: [(output: AVAssetReaderOutput, input: AVAssetWriterInput)], reader: AVAssetReader,
    writer: AVAssetWriter
  ) async throws(RecordingError) {
    var finished = Array(repeating: false, count: pairs.count)
    while finished.contains(false) {
      if Task.isCancelled {
        reader.cancelReading()
        writer.cancelWriting()
        throw .exportFailed("Cancelled.")
      }
      var moved = false
      for (index, pair) in pairs.enumerated() where !finished[index] {
        while pair.input.isReadyForMoreMediaData {
          guard let sample = pair.output.copyNextSampleBuffer() else {
            pair.input.markAsFinished()
            finished[index] = true
            break
          }
          guard pair.input.append(sample) else {
            reader.cancelReading()
            throw .exportFailed(writer.error?.localizedDescription ?? "A sample was refused.")
          }
          moved = true
        }
      }
      if !moved { try? await Task.sleep(for: .milliseconds(5)) }
    }
    if reader.status == .failed {
      writer.cancelWriting()
      throw .exportFailed(reader.error?.localizedDescription ?? "The recording could not be read.")
    }
  }

  private static func settings(_ plan: RecordingAttachmentRules.Reencode) -> [String: Any] {
    [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: plan.pixelWidth,
      AVVideoHeightKey: plan.pixelHeight,
      AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: plan.bitRate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalDurationKey: 2,
      ] as [String: Any],
      AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
      ],
    ]
  }
}
