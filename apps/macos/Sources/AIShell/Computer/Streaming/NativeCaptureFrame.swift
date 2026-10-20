import CoreGraphics
import CoreVideo
import Foundation
import IOSurface
@_weakLinked import ScreenCaptureKit

/// Immutable ownership of one capture buffer. The pixel buffer and IOSurface use count keep the
/// producer from recycling its storage while the latest slot, display or snapshot encoder uses it.
/// Consumers never mutate the pixel buffer or surface; only that immutable ownership crosses queues.
nonisolated final class NativeCaptureFrame: @unchecked Sendable {
  let sequence: Int
  let capturedAt: Date
  let buffer: CVPixelBuffer
  let surface: IOSurface
  let geometry: NativeCaptureGeometry

  init?(
    sequence: Int, capturedAt: Date, buffer: CVPixelBuffer,
    attachments: [SCStreamFrameInfo: Any], crop: CGRect?
  ) {
    guard let surface = CVPixelBufferGetIOSurface(buffer)?.takeUnretainedValue(),
      let geometry = NativeCaptureGeometry(buffer: buffer, attachments: attachments, crop: crop)
    else { return nil }
    self.sequence = sequence
    self.capturedAt = capturedAt
    self.buffer = buffer
    self.surface = surface
    self.geometry = geometry
    IOSurfaceIncrementUseCount(surface)
  }

  deinit { IOSurfaceDecrementUseCount(surface) }
}

/// ScreenCaptureKit's content rect uses surface points with a top-left origin. Convert it
/// with the frame's pixel density before applying a child crop inside the captured content.
nonisolated struct NativeCaptureGeometry: Sendable {
  let pixelRect: CGRect
  let bufferSize: CGSize
  let contentScale: CGFloat
  let scaleFactor: CGFloat

  var logicalSize: CGSize {
    CGSize(
      width: pixelRect.width / (contentScale * scaleFactor),
      height: pixelRect.height / (contentScale * scaleFactor))
  }

  var contentsRect: CGRect {
    CGRect(
      x: pixelRect.minX / bufferSize.width, y: pixelRect.minY / bufferSize.height,
      width: pixelRect.width / bufferSize.width, height: pixelRect.height / bufferSize.height)
  }

  init?(buffer: CVPixelBuffer, attachments: [SCStreamFrameInfo: Any], crop: CGRect?) {
    let size = CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))
    guard size.width > 0, size.height > 0, size.width <= 1280, size.height <= 1280,
      let dictionary = attachments[.contentRect] as? [String: Any],
      let content = CGRect(dictionaryRepresentation: dictionary as CFDictionary),
      let contentScale = attachments[.contentScale] as? CGFloat,
      let scaleFactor = attachments[.scaleFactor] as? CGFloat,
      Self.valid(content), contentScale.isFinite, contentScale > 0,
      scaleFactor.isFinite, scaleFactor > 0,
      (contentScale * scaleFactor).isFinite, contentScale * scaleFactor > 0
    else { return nil }
    let contentPixels = content.applying(
      CGAffineTransform(scaleX: scaleFactor, y: scaleFactor))
    guard Self.valid(contentPixels) else { return nil }
    var pixels = contentPixels
    if let crop {
      guard Self.valid(crop), crop.minX >= 0, crop.minY >= 0,
        crop.maxX <= 1, crop.maxY <= 1
      else { return nil }
      pixels = CGRect(
        x: contentPixels.minX + crop.minX * contentPixels.width,
        y: contentPixels.minY + crop.minY * contentPixels.height,
        width: crop.width * contentPixels.width, height: crop.height * contentPixels.height)
    }
    pixels = pixels.intersection(CGRect(origin: .zero, size: size))
    guard Self.valid(pixels),
      (pixels.width / (contentScale * scaleFactor)).isFinite,
      (pixels.height / (contentScale * scaleFactor)).isFinite
    else { return nil }
    // Round inward so a fractional child boundary cannot admit a neighboring source pixel.
    let left = ceil(pixels.minX)
    let top = ceil(pixels.minY)
    pixels = CGRect(
      x: left, y: top, width: floor(pixels.maxX) - left, height: floor(pixels.maxY) - top)
    guard Self.valid(pixels) else { return nil }
    pixelRect = pixels
    bufferSize = size
    self.contentScale = contentScale
    self.scaleFactor = scaleFactor
  }

  private static func valid(_ rect: CGRect) -> Bool {
    [rect.minX, rect.minY, rect.maxX, rect.maxY, rect.width, rect.height].allSatisfy(\.isFinite)
      && rect.width > 0 && rect.height > 0 && !rect.isNull
  }
}
