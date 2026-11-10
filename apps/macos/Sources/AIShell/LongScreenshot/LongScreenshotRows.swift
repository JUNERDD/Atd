import CoreGraphics
import Foundation

/// Rows of BGRA pixels copied out of a frame, packed `width × 4` bytes apart: the first frame,
/// the head and tail, and each strip's chunks. Copied at once, so no frame's IOSurface is held
/// beyond its callback.
nonisolated struct LongScreenshotRows: Sendable {
  let width: Int
  private(set) var count: Int
  private(set) var data: Data

  var bytesPerRow: Int { width * 4 }

  init(width: Int) {
    self.width = width
    count = 0
    data = Data()
  }

  init(width: Int, count: Int, data: Data) {
    self.width = width
    self.count = count
    self.data = data
  }

  /// Rows `rows` of the frame at `base`, `bytesPerRow` apart, each `width` pixels from column 0.
  init(copying rows: Range<Int>, of base: UnsafeRawPointer, bytesPerRow: Int, width: Int) {
    self.init(width: width)
    append(rows, of: base, bytesPerRow: bytesPerRow)
  }

  mutating func append(_ rows: Range<Int>, of base: UnsafeRawPointer, bytesPerRow: Int) {
    let packed = width * 4
    data.reserveCapacity(data.count + rows.count * packed)
    for row in rows {
      data.append(
        base.advanced(by: row * bytesPerRow).assumingMemoryBound(to: UInt8.self), count: packed)
    }
    count += rows.count
  }

  /// These rows below `other`'s.
  func appended(to other: LongScreenshotRows) -> LongScreenshotRows {
    LongScreenshotRows(width: width, count: other.count + count, data: other.data + data)
  }

  /// Rows `range` of these.
  func slice(_ range: Range<Int>) -> LongScreenshotRows {
    let clamped = range.clamped(to: 0..<count)
    let bytes = (clamped.lowerBound * bytesPerRow)..<(clamped.upperBound * bytesPerRow)
    return LongScreenshotRows(width: width, count: clamped.count, data: data.subdata(in: bytes))
  }

  /// The rows as an image in `space`, sharing their bytes; nil when there are none.
  func image(in space: CGColorSpace) -> CGImage? {
    guard count > 0, let provider = CGDataProvider(data: data as CFData) else { return nil }
    return CGImage(
      width: width, height: count, bitsPerComponent: 8, bitsPerPixel: 32,
      bytesPerRow: bytesPerRow, space: space, bitmapInfo: Self.bitmapInfo, provider: provider,
      decode: nil, shouldInterpolate: false, intent: .defaultIntent)
  }

  /// ScreenCaptureKit's BGRA: 32-bit little-endian words with alpha first (opaque here).
  static let bitmapInfo = CGBitmapInfo(
    rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
  )
}
