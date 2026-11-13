import AICore
import AVFoundation
import CoreGraphics
import Foundation
import Testing

/// Real H.264 input for production keyframe/export checks, containing only generated pixels.
/// Encoding finishes before sampling starts; each take receives its own copy for cleanup checks.
nonisolated struct RecordingMediaFixture: Sendable {
  let folder: URL
  let movie: URL
  let width: Int
  let height: Int
  let duration: Double
  static let profile = ProcessInfo.processInfo.environment["ATD_RECORDING_PROFILE"] == "1"

  @concurrent
  static func make() async throws -> Self {
    let folder = URL.temporaryDirectory.appending(path: "atd-recording-media-\(UUID())")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let fixture = Self(
      folder: folder, movie: folder.appending(path: "source.mp4"),
      width: profile ? 3840 : 1920, height: profile ? 2160 : 1080,
      duration: profile ? 12 : 2)
    do {
      try await fixture.encode()
      return fixture
    } catch {
      fixture.dispose()
      throw error
    }
  }

  func result(in folder: URL) throws -> RecordingResult {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let movie = folder.appending(path: "recording.mp4")
    try FileManager.default.copyItem(at: self.movie, to: movie)
    let take = RecordingTake(
      folder: folder, movie: movie, duration: duration, pixelWidth: width, pixelHeight: height,
      pointSize: CGSize(width: width / 2, height: height / 2),
      startedAt: Date(timeIntervalSince1970: 1_700_000_000), events: [], screenChanges: [],
      microphone: [], appName: "Generated recording fixture")
    return RecordingResult(
      take: take, app: take.appName, steps: [],
      keyframeTimes: (0..<8).map { Double($0) * (duration - 0.05) / 7 },
      narration: .microphoneOff)
  }

  func dispose() { try? FileManager.default.removeItem(at: folder) }

  private func encode() async throws {
    let writer = try AVAssetWriter(outputURL: movie, fileType: .mp4)
    let size = CGSize(width: width, height: height)
    let config = RecordingConfig(
      displayID: 0, rect: CGRect(origin: .zero, size: size), fps: 30, maxOutputWidth: nil,
      microphoneID: nil, systemAudio: false, showsPointer: false, showsClicks: false,
      showsKeys: false)
    let plan = try #require(RecordingStreamPlan.make(config, displaySize: size, scale: 1))
    try #require(plan.pixelWidth == width && plan.pixelHeight == height)
    let fps = Int32(plan.fps)
    let frames = Int(duration * Double(fps))
    // Match RecordingWriterState.videoSettings, including its two-second GOP and disabled
    // frame reordering. Different encoding settings can change seek/cancellation latency.
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width, AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: plan.averageBitRate,
          AVVideoExpectedSourceFrameRateKey: plan.fps,
          AVVideoMaxKeyFrameIntervalKey: plan.fps * 2,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoAllowFrameReorderingKey: false,
        ],
        AVVideoColorPropertiesKey: [
          AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
          AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
          AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
      ])
    input.expectsMediaDataInRealTime = true
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
      ])
    try #require(writer.canAdd(input))
    writer.add(input)
    try #require(writer.startWriting())
    writer.startSession(atSourceTime: .zero)
    var finished = false
    defer { if !finished { writer.cancelWriting() } }
    let pool = try #require(adaptor.pixelBufferPool)
    for frame in 0..<frames {
      while !input.isReadyForMoreMediaData {
        try #require(writer.status == .writing, "\(String(describing: writer.error))")
        try await Task.sleep(for: .milliseconds(1))
      }
      try Task.checkCancellation()
      try autoreleasepool {
        var pixel: CVPixelBuffer?
        try #require(CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixel) == kCVReturnSuccess)
        let buffer = try #require(pixel)
        try draw(frame: frame, into: buffer)
        try #require(
          adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: fps)),
          "\(String(describing: writer.error))")
      }
    }
    writer.endSession(atSourceTime: CMTime(value: Int64(frames), timescale: fps))
    input.markAsFinished()
    await withCheckedContinuation { continuation in
      writer.finishWriting { continuation.resume() }
    }
    try #require(writer.status == .completed, "\(String(describing: writer.error))")
    finished = true
  }

  private func draw(frame: Int, into buffer: CVPixelBuffer) throws {
    try #require(CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess)
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    let context = try #require(
      CGContext(
        data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue
          | CGImageAlphaInfo.noneSkipFirst.rawValue))
    context.setFillColor(CGColor(gray: 0.12, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    for row in 0..<36 {
      let shade = CGFloat((row * 17 + frame * 3) % 255) / 255
      context.setFillColor(CGColor(red: shade, green: 0.5, blue: 1 - shade, alpha: 1))
      context.fill(
        CGRect(
          x: (frame * 13 + row * 7) % (width / 4), y: row * height / 36,
          width: width * 3 / 4, height: max(1, height / 72)))
    }
  }
}
