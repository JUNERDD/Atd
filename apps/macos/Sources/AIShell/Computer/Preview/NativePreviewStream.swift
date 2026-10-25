import Foundation
@_weakLinked import ScreenCaptureKit

/// One independent, window-only stream, with no effect on the engine's observations or input.
final class NativePreviewStream: NSObject, ComputerPreviewStream, SCStreamDelegate {
  private var stream: SCStream?
  private var failed = false
  private var stopped = false
  private nonisolated let output: NativeCaptureFrames

  init(crop: CGRect?) { output = NativeCaptureFrames(crop: crop) }

  var nativeFrames: NativeCaptureFrames? { output }

  func start(plan: NativeWindowCapture.Plan) async throws {
    try Task.checkCancellation()
    guard !stopped else { throw CancellationError() }
    let config = try NativeCaptureConfiguration.make(
      width: Double(plan.pixelWidth), height: Double(plan.pixelHeight), cursor: false)
    let stream = SCStream(filter: plan.filter, configuration: config, delegate: self)
    self.stream = stream
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: output.queue)
    try await stream.startCapture()
    if stopped || Task.isCancelled {
      output.stop()
      try? await stream.stopCapture()
      throw CancellationError()
    }
  }

  func latest() async throws -> ComputerPreviewFrame? {
    if failed { throw CocoaError(.fileReadUnknown) }
    return await output.image()
  }

  func stop() async {
    stopped = true
    output.stop()
    let stream = self.stream
    self.stream = nil
    try? await stream?.stopCapture()
  }

  nonisolated func stream(_ stream: SCStream, didStopWithError error: any Error) {
    output.stop()
    Task { @MainActor [weak self] in
      self?.failed = true
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
