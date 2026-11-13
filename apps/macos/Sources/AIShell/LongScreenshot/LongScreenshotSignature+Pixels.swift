import AICore
import Accelerate
import Foundation
import zlib

extension LongScreenshotSignature {
  /// Hashes a frame's band: rows `rows` and columns `columns` of the BGRA pixels at `base`,
  /// `bytesPerRow` apart (the locked pixel buffer, read only while this runs). `scratch` holds
  /// the band turned on its side, so each column is hashed as one contiguous run; it is reused
  /// frame after frame on the stream's queue. Nil when that rotation fails.
  ///
  /// Every pass is a C routine (zlib's CRC-32 and Adler-32, `memcmp`, vImage), so a Debug build
  /// keeps up with the stream as well as a Release one; a Swift loop over every pixel does not.
  nonisolated static func hashing(
    pixels base: UnsafeRawPointer, bytesPerRow: Int, rows: Range<Int>, columns: Range<Int>,
    scratch: LongScreenshotScratch
  ) -> LongScreenshotSignature? {
    let width = columns.count
    let segments = segmentCount(columns: width)
    let spans = (0..<segments).map { segmentColumns($0, of: segments, columns: width) }
    var cells = [UInt64](repeating: 0, count: rows.count * segments)
    var informative = [Bool](repeating: false, count: cells.count)
    for (index, row) in rows.enumerated() {
      let start = base.advanced(by: row * bytesPerRow + columns.lowerBound * 4)
      for (segment, span) in spans.enumerated() {
        let cell = start.advanced(by: span.lowerBound * 4)
        cells[index * segments + segment] = hash(cell, bytes: span.count * 4)
        informative[index * segments + segment] = !isUniform(cell, pixels: span.count)
      }
    }
    guard let turned = scratch.rotated(base, bytesPerRow: bytesPerRow, rows: rows, columns: columns)
    else { return nil }
    let runBytes = rows.count * 4
    var columnHashes = [UInt64](repeating: 0, count: width)
    var columnsInformative = [Bool](repeating: false, count: width)
    for column in 0..<width {
      let run = UnsafeRawPointer(turned.advanced(by: column * runBytes))
      columnHashes[column] = hash(run, bytes: runBytes)
      columnsInformative[column] = !isUniform(run, pixels: rows.count)
    }
    return LongScreenshotSignature(
      rows: rows.count, segments: segments, cells: cells, informative: informative,
      columns: columnHashes, columnsInformative: columnsInformative)
  }

  /// CRC-32 and Adler-32 of the same bytes, side by side: equal pixels, equal hashes.
  private nonisolated static func hash(_ bytes: UnsafeRawPointer, bytes count: Int) -> UInt64 {
    let data = bytes.assumingMemoryBound(to: Bytef.self)
    let crc = crc32(0, data, uInt(count))
    let adler = adler32(1, data, uInt(count))
    return UInt64(crc) << 32 | UInt64(adler & 0xFFFF_FFFF)
  }

  /// Whether `pixels` 32-bit pixels are all one: each equals the next.
  private nonisolated static func isUniform(_ start: UnsafeRawPointer, pixels: Int) -> Bool {
    pixels < 2 || memcmp(start, start.advanced(by: 4), (pixels - 1) * 4) == 0
  }
}

/// Scratch memory for ``LongScreenshotSignature/hashing(pixels:bytesPerRow:rows:columns:scratch:)``,
/// used on the stream's queue only (one frame at a time), hence unchecked.
nonisolated final class LongScreenshotScratch: @unchecked Sendable {
  private var memory: UnsafeMutableRawPointer?
  private var capacity = 0

  deinit { memory?.deallocate() }

  /// The band turned a quarter clockwise: run `c` (of `rows.count` pixels) is column
  /// `columns.lowerBound + c`.
  func rotated(
    _ base: UnsafeRawPointer, bytesPerRow: Int, rows: Range<Int>, columns: Range<Int>
  ) -> UnsafeMutableRawPointer? {
    let bytes = rows.count * columns.count * 4
    if bytes > capacity {
      memory?.deallocate()
      memory = UnsafeMutableRawPointer.allocate(byteCount: bytes, alignment: 16)
      capacity = bytes
    }
    guard let memory else { return nil }
    var source = vImage_Buffer(
      data: UnsafeMutableRawPointer(
        mutating: base.advanced(by: rows.lowerBound * bytesPerRow + columns.lowerBound * 4)),
      height: vImagePixelCount(rows.count), width: vImagePixelCount(columns.count),
      rowBytes: bytesPerRow)
    var target = vImage_Buffer(
      data: memory, height: vImagePixelCount(columns.count),
      width: vImagePixelCount(rows.count), rowBytes: rows.count * 4)
    var fill: [UInt8] = [0, 0, 0, 0]
    let error = vImageRotate90_ARGB8888(
      &source, &target, UInt8(kRotate90DegreesClockwise), &fill, vImage_Flags(kvImageNoFlags))
    return error == kvImageNoError ? memory : nil
  }
}
