import AICore
import Foundation
@_weakLinked import ScreenCaptureKit

/// A stream created directly from the system picker's selected filter, without enumerating
/// other windows or checking the separate, broad Screen Recording permission.
final class SharedScreenStream: NSObject, SCStreamDelegate {
  nonisolated let output = NativeCaptureFrames()
  private(set) var stream: SCStream?
  private var stopped = false
  var onEnd: ((ScreenShareReplyWire.Ended) -> Void)?

  func start(filter: SCContentFilter) async throws {
    try Task.checkCancellation()
    guard !stopped else { throw CancellationError() }
    let width = Double(filter.contentRect.width) * Double(filter.pointPixelScale)
    let height = Double(filter.contentRect.height) * Double(filter.pointPixelScale)
    let config = try NativeCaptureConfiguration.make(width: width, height: height, cursor: true)
    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    self.stream = stream
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: output.queue)
    try await stream.startCapture()
    if stopped || Task.isCancelled {
      output.stop()
      try? await stream.stopCapture()
      throw CancellationError()
    }
  }

  /// Clear pixels synchronously, before asynchronous teardown has a chance to suspend.
  func invalidate() {
    stopped = true
    output.stop()
  }

  func stop() async {
    invalidate()
    let stream = self.stream
    self.stream = nil
    try? await stream?.stopCapture()
  }

  nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
    let native = error as NSError
    let reason: ScreenShareReplyWire.Ended =
      native.domain == SCStreamErrorDomain && native.code == SCStreamError.userStopped.rawValue
      ? .stopped : .captureFailed
    output.stop()
    Task { @MainActor [weak self] in
      guard let self, !self.stopped else { return }
      self.onEnd?(reason)
    }
  }

  @available(macOS 15.2, *)
  nonisolated func streamDidBecomeInactive(_ stream: SCStream) {
    output.setStreamActive(false)
  }

  @available(macOS 15.2, *)
  nonisolated func streamDidBecomeActive(_ stream: SCStream) {
    output.setStreamActive(true)
  }
}
