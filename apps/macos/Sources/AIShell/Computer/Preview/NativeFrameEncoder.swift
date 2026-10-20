import AppKit
import CoreImage

/// Bounded, on-demand encoding on the frame store's independent serial snapshot queue.
/// Capture callbacks and native display never perform image conversion or JPEG compression.
nonisolated final class NativeFrameEncoder: Sendable {
  struct Image: Sendable {
    let width: Int
    let height: Int
    let data: Data
  }

  private let context = CIContext(options: [.cacheIntermediates: false])

  func encode(_ frame: NativeCaptureFrame) -> Image? {
    let pixels = frame.geometry.pixelRect
    let image = CIImage(cvPixelBuffer: frame.buffer).cropped(
      to: CGRect(
        x: pixels.minX, y: frame.geometry.bufferSize.height - pixels.maxY,
        width: pixels.width, height: pixels.height))
    guard let cg = context.createCGImage(image, from: image.extent),
      cg.width > 0, cg.height > 0, cg.width <= 1280, cg.height <= 1280
    else { return nil }
    let bitmap = NSBitmapImageRep(cgImage: cg)
    guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.6]),
      data.count <= 1_048_576
    else { return nil }
    return Image(width: cg.width, height: cg.height, data: data)
  }
}
