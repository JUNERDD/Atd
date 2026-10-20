import AICore
import CoreGraphics
import Foundation

/// The live preview of a window on another Space, where ScreenCaptureKit returns nothing: the
/// driver's capture, cut to the surface's part of the window, bounded to ``longEdge`` and
/// encoded as JPEG off the main actor. It has no timer: a capture happens only inside
/// ``latest()``, at most one per ``interval`` (about four frames a second), and a call within
/// the interval gets the last frame again, so a source nobody reads captures nothing and leaves
/// the driver idle. Its pixels are the preview's alone: they never become an observation or a
/// capture an action may name. Reads that keep failing end the preview, which the next
/// observation registers again.
final class NativeOffSpacePreview: ComputerPreviewStream {
  static let interval: Duration = .milliseconds(250)
  /// The long edge of a frame in pixels, as the window stream's encoder bounds it.
  static let longEdge = 1280
  /// Failed reads in a row the preview rides out on its last frame.
  static let tolerated = 3

  private let crop: CGRect?
  private let read: () async -> NativeEngine.WindowPixels?
  private var last: ComputerPreviewFrame?
  private var lastRead: ContinuousClock.Instant?
  private var failures = 0
  private var stopped = false

  /// `crop` is the surface's part of its window (points from the window's top-left corner) when
  /// it is not the whole window.
  init(crop: CGRect?, read: @escaping () async -> NativeEngine.WindowPixels?) {
    self.crop = crop
    self.read = read
  }

  func latest() async throws -> ComputerPreviewFrame? {
    guard !stopped else { throw CancellationError() }
    if let lastRead, ContinuousClock.now - lastRead < Self.interval { return last }
    lastRead = .now
    let (crop, edge) = (self.crop, Self.longEdge)
    var encoded: NativeCaptureImage.Frame?
    if let pixels = await read() {
      encoded = await NativeTargetProbe.detached {
        NativeCaptureImage.previewFrame(
          pixels.image, size: pixels.frame.size, crop: crop, longEdge: edge)
      }
    }
    guard !stopped else { throw CancellationError() }
    guard let encoded else {
      failures += 1
      guard failures < Self.tolerated else {
        throw ComputerFailure(
          .targetUnavailable, "The window on another Space can no longer be captured.")
      }
      return last
    }
    failures = 0
    let frame = ComputerPreviewFrame(
      sequence: (last?.sequence ?? 0) + 1, capturedAt: Date(), width: encoded.width,
      height: encoded.height, data: encoded.data)
    last = frame
    return frame
  }

  func stop() async { stopped = true }
}
