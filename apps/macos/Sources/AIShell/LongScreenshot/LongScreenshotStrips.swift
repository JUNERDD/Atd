import CoreGraphics
import Foundation

/// The rows later frames add to a long screenshot, above and below the first frame's, in
/// chunks of up to ``chunkRows`` rows. The chunk at the growing end of each side stays raw while
/// it fills; a full chunk is compressed (LZ4, a few milliseconds), so a long capture costs far
/// less memory than its pixels while the frozen desktop is still held for Esc. Each chunk keeps
/// a small thumbnail for the preview strip, which therefore never decompresses anything.
nonisolated struct LongScreenshotStrips: Sendable {
  static let chunkRows = 256

  struct Chunk: Sendable {
    /// Its first document row and its height.
    var top: Int
    var rows: Int
    /// Its pixels: raw while it fills, compressed once full.
    var raw: LongScreenshotRows?
    var packed: Data?
    var thumbnail: CGImage?

    var range: Range<Int> { top..<(top + rows) }
  }

  let width: Int
  let thumbnails: LongScreenshotThumbnails
  /// Top to bottom on each side; `above.first` and `below.last` are the growing ends.
  private(set) var above: [Chunk] = []
  private(set) var below: [Chunk] = []

  var chunks: [Chunk] { above + below }

  init(width: Int, thumbnails: LongScreenshotThumbnails) {
    self.width = width
    self.thumbnails = thumbnails
  }

  /// `rows` become document rows from `top` down, just below everything below.
  mutating func append(_ rows: LongScreenshotRows, top: Int) {
    var next = 0
    if let index = below.indices.last, below[index].rows < Self.chunkRows,
      below[index].range.upperBound == top, let raw = below[index].raw
    {
      let taken = min(rows.count, Self.chunkRows - below[index].rows)
      var last = below[index]
      last.raw = rows.slice(0..<taken).appended(to: raw)
      last.rows += taken
      below[index] = finished(last)
      next = taken
    }
    while next < rows.count {
      let taken = min(rows.count - next, Self.chunkRows)
      below.append(finished(chunk(rows.slice(next..<(next + taken)), top: top + next)))
      next += taken
    }
  }

  /// `rows` become document rows from `top` down, just above everything above.
  mutating func prepend(_ rows: LongScreenshotRows, top: Int) {
    var remaining = rows.count
    if let first = above.first, first.rows < Self.chunkRows, first.top == top + rows.count,
      let raw = first.raw
    {
      let taken = min(rows.count, Self.chunkRows - first.rows)
      var grown = first
      grown.raw = raw.appended(to: rows.slice((rows.count - taken)..<rows.count))
      grown.rows += taken
      grown.top -= taken
      above[0] = finished(grown)
      remaining -= taken
    }
    while remaining > 0 {
      let taken = min(remaining, Self.chunkRows)
      let start = remaining - taken
      above.insert(finished(chunk(rows.slice(start..<remaining), top: top + start)), at: 0)
      remaining = start
    }
  }

  /// Keeps only the document rows `above` and `below` hold now (an edge cut an overshoot).
  mutating func keep(above kept: Range<Int>?, below keptBelow: Range<Int>?) {
    above = trimmed(above, to: kept)
    below = trimmed(below, to: keptBelow)
  }

  /// A chunk's pixels, decompressed when packed.
  static func pixels(of chunk: Chunk, width: Int) -> LongScreenshotRows? {
    if let raw = chunk.raw { return raw }
    guard let packed = chunk.packed,
      let data = try? (packed as NSData).decompressed(using: .lz4) as Data
    else { return nil }
    return LongScreenshotRows(width: width, count: chunk.rows, data: data)
  }

  private func chunk(_ rows: LongScreenshotRows, top: Int) -> Chunk {
    Chunk(top: top, rows: rows.count, raw: rows, packed: nil, thumbnail: nil)
  }

  /// `chunk` with a fresh thumbnail, compressed when full (raw still when compression fails or
  /// saves nothing).
  private func finished(_ chunk: Chunk) -> Chunk {
    var done = chunk
    guard let raw = chunk.raw else { return done }
    done.thumbnail = thumbnails.make(raw)
    guard chunk.rows >= Self.chunkRows,
      let packed = try? (raw.data as NSData).compressed(using: .lz4) as Data,
      packed.count < raw.data.count
    else { return done }
    done.packed = packed
    done.raw = nil
    return done
  }

  private func trimmed(_ chunks: [Chunk], to kept: Range<Int>?) -> [Chunk] {
    guard let kept else { return [] }
    return chunks.compactMap { chunk in
      let range = chunk.range.clamped(to: kept)
      guard !range.isEmpty else { return nil }
      guard range != chunk.range else { return chunk }
      guard let pixels = Self.pixels(of: chunk, width: width) else { return nil }
      let rows = pixels.slice((range.lowerBound - chunk.top)..<(range.upperBound - chunk.top))
      return Chunk(
        top: range.lowerBound, rows: rows.count, raw: rows, packed: nil,
        thumbnail: thumbnails.make(rows))
    }
  }
}

/// Small copies of rows for the preview strip, at one scale for the whole capture.
nonisolated struct LongScreenshotThumbnails: Sendable {
  /// Thumbnails are at most this wide: the preview strip is narrower at any backing scale.
  static let maximumWidth: CGFloat = 320

  /// Thumbnail pixels per image pixel.
  let scale: CGFloat
  let space: CGColorSpace

  init(width: Int, space: CGColorSpace) {
    scale = min(1, Self.maximumWidth / CGFloat(max(1, width)))
    self.space = space
  }

  func make(_ rows: LongScreenshotRows) -> CGImage? {
    guard let image = rows.image(in: space) else { return nil }
    let width = max(1, Int((CGFloat(rows.width) * scale).rounded()))
    let height = max(1, Int((CGFloat(rows.count) * scale).rounded()))
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: space, bitmapInfo: LongScreenshotRows.bitmapInfo.rawValue)
    else { return nil }
    context.interpolationQuality = .medium
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
  }
}
