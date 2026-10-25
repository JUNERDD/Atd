import Foundation

/// A presentation lease on a system share. Only ScreenSharingSession owns capture teardown.
final class ComputerBorrowedPreview: ComputerPreviewStream {
  let nativeFrames: NativeCaptureFrames?

  init(frames: NativeCaptureFrames) { nativeFrames = frames }

  func latest() async throws -> ComputerPreviewFrame? { await nativeFrames?.image() }
  func stop() async {}
}
