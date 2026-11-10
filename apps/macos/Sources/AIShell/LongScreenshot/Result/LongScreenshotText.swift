import AICore
import CoreGraphics
import Foundation

/// The recognized text of a long screenshot and its sensitive parts (decision D8), for the result
/// card and the context Atd reads. Vision reads screen-sized images well but degrades on very
/// tall ones, so ``ScreenText`` reads the image in tiles at most ``tileHeight`` pixels tall that
/// overlap by ``overlap``, a few at a time, and their boxes are placed back in image points
/// (origin at the top-left).
///
/// A line across a seam comes back cut in one tile and whole in the other. Each tile keeps only
/// the lines and parts whose centre lies in its own band, which reaches half the overlap past
/// each of its seams: while a line is shorter than the overlap, a cut one's centre always lies
/// outside the band of the tile that cut it and its whole reading's inside the other's, so no line
/// comes twice and none is lost. A tile that fails or runs past ``timeout`` adds nothing; the
/// others still count.
nonisolated enum LongScreenshotText {
  /// About a screen and a half on a Retina display: as tall as Vision reads reliably.
  static let tileHeight = 2000
  /// Taller than a line of text gets on screen at 2× (headings included), so every line lies
  /// whole in some tile.
  static let overlap = 320
  /// Tiles read at once: Vision's work is shared by the Neural Engine and the GPU, so more only
  /// wait in line while holding their pixels.
  static let concurrentTiles = 3
  /// One tile's bound; nothing waits on it but the processing capsule.
  static let timeout = Duration.seconds(10)

  struct Reading: Sendable {
    /// In reading order: top to bottom, then left to right.
    let lines: [LongScreenshotLine]
    let sensitive: [SensitiveText.Box]
  }

  /// One tile: the pixel rows it covers and the rows of its own band.
  struct Tile: Sendable {
    let rows: Range<Int>
    let band: Range<Int>
  }

  /// The tiles of an image `height` pixels tall, top to bottom; one for an image that fits.
  static func tiles(height: Int) -> [Tile] {
    guard height > tileHeight else {
      return height > 0 ? [Tile(rows: 0..<height, band: 0..<height)] : []
    }
    let stride = tileHeight - overlap
    let count = (height - overlap + stride - 1) / stride
    return (0..<count).map { index in
      let top = index * stride
      let last = index == count - 1
      let rows = top..<(last ? height : top + tileHeight)
      let lower = index == 0 ? 0 : top + overlap / 2
      let upper = last ? height : top + stride + overlap / 2
      return Tile(rows: rows, band: lower..<upper)
    }
  }

  /// Every line and sensitive part of `image` (`scale` pixels per point). Cancelling the calling
  /// task stops the tiles still running and answers what the others found.
  @concurrent
  static func read(_ image: CGImage, scale: CGFloat) async -> Reading {
    let tiles = tiles(height: image.height)
    var found: [(index: Int, reading: Reading)] = []
    await withTaskGroup(of: (Int, Reading).self) { group in
      var next = 0
      func start() {
        guard next < tiles.count else { return }
        let index = next
        next += 1
        group.addTask { (index, await read(tiles[index], of: image, scale: scale)) }
      }
      for _ in 0..<concurrentTiles { start() }
      for await (index, reading) in group {
        found.append((index, reading))
        if !Task.isCancelled { start() }
      }
    }
    let ordered = found.sorted { $0.index < $1.index }.map(\.reading)
    let lines = ordered.flatMap(\.lines).sorted {
      $0.box.midY != $1.box.midY ? $0.box.midY < $1.box.midY : $0.box.minX < $1.box.minX
    }
    return Reading(lines: lines, sensitive: ordered.flatMap(\.sensitive))
  }

  /// `tile` of `image` read on its own: its boxes in image points, only those of its band.
  private static func read(_ tile: Tile, of image: CGImage, scale: CGFloat) async -> Reading {
    let rect = CGRect(x: 0, y: tile.rows.lowerBound, width: image.width, height: tile.rows.count)
    guard let part = image.cropping(to: rect),
      let scan = await ScreenText.scan(in: part, timeout: timeout)
    else { return Reading(lines: [], sensitive: []) }
    let size = CGSize(width: CGFloat(part.width), height: CGFloat(part.height))
    let top = CGFloat(tile.rows.lowerBound)
    /// A normalized box of the tile in image points, or nil when its centre is outside the band.
    func placed(_ box: CGRect) -> CGRect? {
      let pixels = CGRect(
        x: box.minX * size.width, y: top + box.minY * size.height, width: box.width * size.width,
        height: box.height * size.height)
      guard tile.band.contains(Int(pixels.midY)) else { return nil }
      return CGRect(
        x: pixels.minX / scale, y: pixels.minY / scale, width: pixels.width / scale,
        height: pixels.height / scale)
    }
    return Reading(
      lines: scan.boxes.compactMap { box in
        placed(box.box).map { LongScreenshotLine(text: box.text, box: $0) }
      },
      sensitive: scan.sensitive.compactMap { part in
        placed(part.box).map { SensitiveText.Box(kind: part.kind, box: $0) }
      })
  }
}
