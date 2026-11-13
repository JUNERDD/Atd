import AICore
import CoreMedia
import Foundation
@_weakLinked import ScreenCaptureKit

/// ScreenCaptureKit's callbacks for one take. Samples arrive on the writer's queue and go to it
/// synchronously, in order; the stream's end reaches the recorder on the main actor, with the
/// host time it ended at.
nonisolated final class RecordingStreamOutput: NSObject, SCStreamOutput, SCStreamDelegate,
  Sendable
{
  let writer: RecordingWriter
  private let onStop: @MainActor @Sendable (RecordingInterruption, Double) -> Void

  init(
    writer: RecordingWriter,
    onStop: @escaping @MainActor @Sendable (RecordingInterruption, Double) -> Void
  ) {
    self.writer = writer
    self.onStop = onStop
  }

  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    writer.append(sampleBuffer, of: type)
  }

  /// The system's stop (the screen-sharing menu's Stop) or a failure; never called for the
  /// recorder's own `stopCapture`.
  func stream(_ stream: SCStream, didStopWithError error: any Error) {
    let time = RecordingSamples.hostNow
    writer.stop(at: time)
    let native = error as NSError
    let interruption: RecordingInterruption =
      native.domain == SCStreamErrorDomain && native.code == SCStreamError.userStopped.rawValue
      ? .stoppedBySystem : .failed(native.localizedDescription)
    let onStop = onStop
    Task { @MainActor in onStop(interruption, time) }
  }
}
