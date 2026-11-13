import AICore
import CoreMedia
import Foundation
@_weakLinked import ScreenCaptureKit

/// ScreenCaptureKit's callbacks for one long screenshot (decision D2): frames arrive on
/// ``queue`` and go to the engine synchronously, one at a time; a stop the system made reaches
/// the capture on the main actor.
nonisolated final class LongScreenshotStream: NSObject, SCStreamOutput, SCStreamDelegate,
  Sendable
{
  /// Frames per second: enough for scrolling by hand to keep an overlap, few enough that every
  /// frame is matched before the next.
  static let framesPerSecond: Int32 = 12

  let queue = DispatchSerialQueue(label: "com.junerdd.ai.long-screenshot", qos: .userInitiated)
  let engine: LongScreenshotEngine
  private let onStop: @MainActor @Sendable (any Error) -> Void

  init(engine: LongScreenshotEngine, onStop: @escaping @MainActor @Sendable (any Error) -> Void) {
    self.engine = engine
    self.onStop = onStop
  }

  /// The stream for `geometry`: its source rect at the display's own pixels (no scaling, so
  /// equal pixels stay equal from frame to frame), BGRA, SDR, without the cursor, in the
  /// display's colour space as screenshots are (``DisplayFreezer``), with a short queue: a frame
  /// held back is a frame matched late.
  static func configuration(for geometry: LongScreenshotGeometry) -> SCStreamConfiguration {
    let configuration = SCStreamConfiguration()
    configuration.width = geometry.width
    configuration.height = geometry.height
    configuration.sourceRect = geometry.sourceRect
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: framesPerSecond)
    configuration.queueDepth = 4
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.captureDynamicRange = .SDR
    configuration.captureResolution = .best
    configuration.preservesAspectRatio = false
    configuration.showsCursor = false
    return configuration
  }

  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .screen, sampleBuffer.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(
        sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int, let status = SCFrameStatus(rawValue: raw)
    else { return }
    let time = ProcessInfo.processInfo.systemUptime
    switch status {
    case .complete:
      if let buffer = sampleBuffer.imageBuffer { engine.receive(buffer, at: time) }
    case .idle:
      // Nothing changed on screen: as good as a frame showing the page where it was.
      engine.idle(at: time)
    case .blank, .suspended, .started, .stopped:
      break
    @unknown default:
      break
    }
  }

  /// The system's stop (the screen-sharing menu's Stop, a revoked grant, a display gone); never
  /// called for the capture's own `stopCapture`.
  func stream(_ stream: SCStream, didStopWithError error: any Error) {
    let onStop = onStop
    Task { @MainActor in onStop(error) }
  }
}
