import AIComputerDriverKit
import AICore
import CoreGraphics
import Foundation

/// A capture of an observed surface (plan §4.4): ScreenCaptureKit's still of the window, which
/// keeps capturing it while it is covered or off screen, or, for a window on another Space, the
/// driver's capture. The whole window is bounded to the screenshot's long edge; a surface inside
/// a larger window, or a region, is cut from it at the source's pixels per point (a region is
/// read at the window's native resolution). Decoding, scaling and encoding run off the main
/// actor.
extension NativeEngine {
  /// The long edge of a whole-window screenshot, in pixels.
  static let screenshotEdge = 1600

  struct Shot {
    var screenshot: ObservationWire.Screenshot?
    var capture: NativeCapture?
    var image: CGImage?
    var problems: [ComputerObservationProblem] = []
  }

  /// The window's whole image now, with its frame and the encoding it arrived in.
  struct WindowPixels: Sendable {
    let image: CGImage
    let frame: CGRect
    let mime: ComputerImageMime
    /// The driver's JPEG as it came, reused when nothing is cut or scaled.
    let encoded: String?
  }

  /// The capture of `place`, or problems when no valid image came.
  func shot(
    _ place: NativeSurfaceRead, region: CGRect?, onActiveSpace: Bool, id: String,
    useBy: NativeCapture.UseBy, operation: String?
  ) async -> Shot {
    guard let source = await windowPixels(place, onActiveSpace: onActiveSpace, operation: operation)
    else { return Shot(problems: [.screenshotUnavailable]) }
    let frame = source.frame
    guard
      NativeCapture.scale(frame: frame, width: source.image.width, height: source.image.height)
        != nil
    else { return Shot(problems: [.screenshotFrameInvalid]) }
    let window = CGRect(origin: .zero, size: frame.size)
    let surface = place.cropFrame.map {
      CGRect(x: $0.minX - frame.minX, y: $0.minY - frame.minY, width: $0.width, height: $0.height)
    }
    let crop = (region ?? surface).map { $0.intersection(window) }
    if let crop, crop.isNull || crop.isEmpty { return Shot(problems: [.screenshotUnavailable]) }
    let native = region != nil
    let edge = Self.screenshotEdge
    let whole = await NativeTargetProbe.detached {
      native ? source.image : NativeCaptureImage.bounded(source.image, longEdge: edge)
    }
    let capture = NativeCapture(
      id: id, surfaceRefId: place.surfaceRefId, pid: place.pid, windowId: place.windowId,
      frame: frame, crop: crop, mime: crop == nil ? source.mime : .png, sourceWidth: whole.width,
      sourceHeight: whole.height, capturedAt: Date(), useBy: useBy)
    let pixels = capture.sourcePixels
    let reusable = crop == nil && whole.width == source.image.width ? source.encoded : nil
    let encoded: (image: CGImage, base64: String)? = await NativeTargetProbe.detached {
      if crop != nil { return NativeCaptureImage.crop(whole, to: pixels) }
      if let reusable { return (whole, reusable) }
      return NativeCaptureImage.png(whole).map { (whole, $0) }
    }
    guard let encoded, encoded.base64.count <= ComputerWireLimits.maxScreenshotBase64 else {
      return Shot(problems: [.screenshotUnavailable])
    }
    return Shot(
      screenshot: ObservationWire.Screenshot(mime: capture.mime, base64: encoded.base64),
      capture: capture, image: encoded.image)
  }

  /// The window's whole image: ScreenCaptureKit on the active Space, the driver's capture on
  /// another (where ScreenCaptureKit returns nothing); nil when neither gives one.
  func windowPixels(_ place: NativeSurfaceRead, onActiveSpace: Bool, operation: String?) async
    -> WindowPixels?
  {
    if onActiveSpace {
      guard
        let shot = try? await NativeWindowCapture.capture(pid: place.pid, windowId: place.windowId)
      else { return nil }
      return WindowPixels(image: shot.image, frame: shot.frame, mime: .png, encoded: nil)
    }
    guard let captured = try? await offSpaceCapture(place, operation: operation),
      let frame = NativeSurfaceProbe.frame(windowId: place.windowId, pid: pid_t(place.pid))
    else { return nil }
    let base64 = captured.jpegBase64
    guard
      let image = await NativeTargetProbe.detached({ NativeCaptureImage.decode(base64: base64) }),
      image.width == captured.pixelWidth, image.height == captured.pixelHeight
    else { return nil }
    return WindowPixels(image: image, frame: frame, mime: .jpeg, encoded: base64)
  }
}
