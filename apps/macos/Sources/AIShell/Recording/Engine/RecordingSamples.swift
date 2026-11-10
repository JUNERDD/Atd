import AICore
import AVFoundation
import CoreMedia
import CoreVideo
@_weakLinked import ScreenCaptureKit

/// One sample ScreenCaptureKit delivered to this take. CoreMedia marks sample buffers
/// non-Sendable because they can be mutated in general; the stream never touches one again after
/// delivering it, and the writer only reads it, under its lock, on the stream's queue, as
/// ``NativeCaptureFrame`` holds the computer-use stream's buffers.
nonisolated struct RecordingSample: @unchecked Sendable {
  let buffer: CMSampleBuffer
}

/// What the writer reads from ScreenCaptureKit's samples: a frame's status, a sample moved in
/// time or placed after the audio before it, a frame's brightness signature and the loudness of
/// microphone audio. Pure functions of the buffer, safe on any queue.
nonisolated enum RecordingSamples {
  /// The host clock's now, in seconds: the clock ScreenCaptureKit stamps samples with and the
  /// one ``RecordingTimeline`` keeps.
  static var hostNow: Double { CMClockGetTime(CMClockGetHostTimeClock()).seconds }

  /// `time` moved earlier by the pauses that ended before it.
  static func shifted(_ time: CMTime, timeline: RecordingTimeline) -> CMTime {
    let paused = time.seconds - timeline.continuous(time.seconds)
    guard paused > 0 else { return time }
    return time - CMTime(seconds: paused, preferredTimescale: max(time.timescale, 1_000_000))
  }

  /// A screen sample's frame status; nil when the sample carries none.
  static func status(of sample: CMSampleBuffer) -> SCFrameStatus? {
    guard
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false)
        as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int
    else { return nil }
    return SCFrameStatus(rawValue: raw)
  }

  /// `sample` with every timestamp moved so it starts at `start`; the sample itself when it
  /// already does, nil when CoreMedia cannot copy it.
  static func retimed(_ sample: CMSampleBuffer, to start: CMTime) -> CMSampleBuffer? {
    let offset = start - sample.presentationTimeStamp
    guard offset != .zero else { return sample }
    guard let timings = try? sample.sampleTimingInfos() else { return nil }
    let moved = timings.map { timing in
      var timing = timing
      timing.presentationTimeStamp = timing.presentationTimeStamp + offset
      if timing.decodeTimeStamp.isValid {
        timing.decodeTimeStamp = timing.decodeTimeStamp + offset
      }
      return timing
    }
    return try? CMSampleBuffer(copying: sample, withNewTiming: moved)
  }

  /// Audio captured outside pauses and before Stop, cutting a buffer's tail when it crosses
  /// either boundary. Buffers already written before a pause are reconciled by ``following``.
  static func audio(_ sample: CMSampleBuffer, within timeline: RecordingTimeline)
    -> CMSampleBuffer?
  {
    let time = sample.presentationTimeStamp.seconds
    guard time.isFinite, timeline.includes(time) else { return nil }
    let pause = timeline.pauses.first { $0.start > time }?.start
    guard let boundary = [pause, timeline.stop].compactMap(\.self).min(),
      time + sample.duration.seconds > boundary
    else { return sample }
    guard let rate = sample.formatDescription?.audioStreamBasicDescription?.mSampleRate,
      rate.isFinite, rate > 0
    else { return nil }
    let frames = ((boundary - time) * rate).rounded(.down)
    if frames >= Double(sample.numSamples) { return sample }
    guard frames.isFinite, frames > 0 else { return nil }
    return copyingPCM(sample, frames: 0..<Int(frames))
  }

  /// Audio `sample`, which belongs at `start` on a track whose audio so far ends at `end`,
  /// placed after it without accumulating an offset. A buffer kept whole across a pause's
  /// start runs past it, so the first one after the pause starts inside it: that one loses its
  /// overlapping head instead of moving later, which would leave every later buffer, and the
  /// track, behind the video. Nil when the overlap covers the whole buffer or CoreMedia cannot
  /// copy it.
  static func following(_ sample: CMSampleBuffer, at start: CMTime, after end: CMTime?)
    -> (buffer: CMSampleBuffer, start: CMTime)?
  {
    guard let end, start < end else { return retimed(sample, to: start).map { ($0, start) } }
    guard let rate = sample.formatDescription?.audioStreamBasicDescription?.mSampleRate,
      rate.isFinite, rate > 0
    else { return nil }
    let frames = ((end - start).seconds * rate).rounded()
    guard frames.isFinite else { return nil }
    if frames == 0 { return retimed(sample, to: start).map { ($0, start) } }
    guard frames > 0, frames < Double(sample.numSamples),
      let rest = copyingPCM(sample, frames: Int(frames)..<sample.numSamples)
    else { return nil }
    // Keep the surviving samples at their natural time. Subframe rounding in the host clock
    // does not remove another PCM frame or push the following buffers later.
    let begin =
      start + CMTime(seconds: frames / rate, preferredTimescale: max(start.timescale, 1_000_000))
    return retimed(rest, to: begin).map { ($0, begin) }
  }

  /// Copies a range of PCM frames; CoreMedia cannot cut the non-interleaved audio
  /// ScreenCaptureKit delivers in place. Nil when copying fails or the audio is not PCM.
  private static func copyingPCM(_ sample: CMSampleBuffer, frames: Range<Int>) -> CMSampleBuffer? {
    let kept = frames.count
    guard kept > 0, frames.lowerBound <= Int32.max, kept <= Int32.max,
      let description = sample.formatDescription,
      description.audioStreamBasicDescription?.mFormatID == kAudioFormatLinearPCM,
      let pcm = AVAudioPCMBuffer(
        pcmFormat: AVAudioFormat(cmAudioFormatDescription: description),
        frameCapacity: AVAudioFrameCount(kept))
    else { return nil }
    pcm.frameLength = AVAudioFrameCount(kept)
    var copy: CMSampleBuffer?
    guard
      CMSampleBufferCopyPCMDataIntoAudioBufferList(
        sample, at: Int32(frames.lowerBound), frameCount: Int32(kept),
        into: pcm.mutableAudioBufferList)
        == noErr,
      CMAudioSampleBufferCreateWithPacketDescriptions(
        allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: false,
        makeDataReadyCallback: nil, refcon: nil, formatDescription: description,
        sampleCount: kept, presentationTimeStamp: sample.presentationTimeStamp,
        packetDescriptions: nil, sampleBufferOut: &copy) == noErr,
      let copy,
      CMSampleBufferSetDataBufferFromAudioBufferList(
        copy, blockBufferAllocator: kCFAllocatorDefault,
        blockBufferMemoryAllocator: kCFAllocatorDefault, flags: 0,
        bufferList: pcm.audioBufferList) == noErr,
      CMSampleBufferSetDataReady(copy) == noErr
    else { return nil }
    return copy
  }

  /// The mean brightness of each cell of a ``ScreenChangeDetector`` grid over a BGRA frame,
  /// from a few pixels per cell; nil for any other pixel format.
  static func signature(of buffer: CVPixelBuffer) -> ScreenChangeDetector.Signature? {
    guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA else { return nil }
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    let columns = ScreenChangeDetector.columns
    let rows = ScreenChangeDetector.rows
    guard width >= columns, height >= rows else { return nil }
    let pixels = base.assumingMemoryBound(to: UInt8.self)
    // Four by four samples per cell keep thin text from flickering a cell on and off.
    let samples = 4
    var values = [UInt8](repeating: 0, count: columns * rows)
    for row in 0..<rows {
      for column in 0..<columns {
        var sum = 0
        for sy in 0..<samples {
          let y = (row * samples + sy) * height / (rows * samples)
          for sx in 0..<samples {
            let x = (column * samples + sx) * width / (columns * samples)
            let pixel = pixels + y * stride + x * 4
            // Rec. 709 luma from B, G, R in 8.8 fixed point.
            sum += (Int(pixel[0]) * 18 + Int(pixel[1]) * 183 + Int(pixel[2]) * 55) >> 8
          }
        }
        values[row * columns + column] = UInt8(min(255, sum / (samples * samples)))
      }
    }
    return ScreenChangeDetector.Signature(columns: columns, rows: rows, values: values)
  }

  /// The loudness of PCM audio, 0 to 1: its RMS level from −50 dBFS (0) to 0 dBFS (1). Float
  /// and 16-bit integer samples are read; nil for anything else.
  static func level(of sample: CMSampleBuffer) -> Double? {
    guard let format = sample.formatDescription?.audioStreamBasicDescription,
      format.mFormatID == kAudioFormatLinearPCM
    else { return nil }
    let isFloat = format.mFormatFlags & kAudioFormatFlagIsFloat != 0
    let bits = format.mBitsPerChannel
    guard (isFloat && bits == 32) || (!isFloat && bits == 16) else { return nil }
    let squares = try? sample.withAudioBufferList { list, _ -> (sum: Double, count: Int) in
      var sum = 0.0
      var count = 0
      for buffer in list {
        guard let data = buffer.mData else { continue }
        if isFloat {
          let values = UnsafeBufferPointer(
            start: data.assumingMemoryBound(to: Float.self),
            count: Int(buffer.mDataByteSize) / MemoryLayout<Float>.size)
          for value in values { sum += Double(value * value) }
          count += values.count
        } else {
          let values = UnsafeBufferPointer(
            start: data.assumingMemoryBound(to: Int16.self),
            count: Int(buffer.mDataByteSize) / MemoryLayout<Int16>.size)
          for value in values {
            let scaled = Double(value) / Double(Int16.max)
            sum += scaled * scaled
          }
          count += values.count
        }
      }
      return (sum, count)
    }
    guard let squares, squares.count > 0 else { return nil }
    let rms = (squares.sum / Double(squares.count)).squareRoot()
    let decibels = 20 * log10(max(rms, 1e-6))
    return min(1, max(0, (decibels + 50) / 50))
  }
}
