import CoreGraphics
import Foundation

/// Where a long screenshot's stream reads and which of its pixels are stitched (decision D2).
///
/// The stream reads the selection's columns over the vertical union of the selection and the
/// scroll area's visible frame, so the rows of the scroll area above and below the selection are
/// in every frame for when the page reaches its start or end (D6). Rows and columns here are the
/// stream's pixels, origin at its top-left. The *band* is the part of the selection over the
/// scroll area: only it moves when the page scrolls, and only it is compared between frames.
public struct LongScreenshotGeometry: Equatable, Sendable {
  /// A scroll area overlapping the selection by less than this, either way, does not count
  /// (decision D5), in points.
  public static let minimumBand: CGFloat = 48
  /// The lane at a scroll area's trailing edge where macOS draws its scroll bar, in points. The
  /// knob moves while the page scrolls, so the lane is never compared, and when the scroll area
  /// ends inside the selection its pixels come from the first frame (otherwise every strip would
  /// carry a piece of the knob).
  public static let scrollerLane: CGFloat = 15

  /// The stream's source rect in display points (origin top-left), on the display's pixel grid.
  public let sourceRect: CGRect
  /// Pixels per point.
  public let scale: CGFloat
  /// The stream's size in pixels; also the stitched image's width.
  public let width: Int
  public let height: Int
  /// The selection's rows.
  public let selectionRows: Range<Int>
  /// The scroll area's visible rows, the selection's when no scroll area is known.
  public let areaRows: Range<Int>
  /// The band's rows: the selection's over the scroll area.
  public let bandRows: Range<Int>
  /// The band's columns: the selection's over the scroll area, all of them when none is known.
  public let bandColumns: Range<Int>
  /// The columns frames are compared on: the band's without the scroll bar's lane.
  public let matchedColumns: Range<Int>
  /// The columns whose pixels move with the page: the band's, without the scroll bar's lane
  /// when the scroll area's trailing edge lies inside the selection. The rest of the image's
  /// columns come from the first frame.
  public let liveColumns: Range<Int>
  /// One screen in pixels: the scroll area's visible height, else the selection's.
  public let screenRows: Int
  /// The most rows the stitched image may have (``maximumRows(width:)``); settable so a check can
  /// use a small limit.
  public var maxRows: Int

  /// The geometry for `selection` over `scrollArea` (both display points, origin top-left) on a
  /// display of `displaySize` points at `scale` pixels per point; nil when the selection leaves
  /// less than two pixels of the display either way. A scroll area that overlaps the selection by
  /// less than ``minimumBand`` either way is ignored.
  public static func make(
    selection: CGRect, scrollArea: CGRect?, displaySize: CGSize, scale: CGFloat
  ) -> LongScreenshotGeometry? {
    let display = CGRect(origin: .zero, size: displaySize)
    let picked = selection.standardized.intersection(display)
    guard !picked.isNull else { return nil }
    let area = scrollArea.map { $0.standardized.intersection(display) }.flatMap { area in
      let overlap = area.intersection(picked)
      return overlap.isNull || overlap.width < minimumBand || overlap.height < minimumBand
        ? nil : area
    }
    let top = min(picked.minY, area?.minY ?? picked.minY)
    let bottom = max(picked.maxY, area?.maxY ?? picked.maxY)
    let source = CGRect(x: picked.minX, y: top, width: picked.width, height: bottom - top)
    guard
      let pixels = DisplayPixelGrid.pixels(of: source, displaySize: displaySize, scale: scale),
      pixels.width >= 2, pixels.height >= 2
    else { return nil }
    let grid = Grid(origin: pixels.origin, size: pixels.size, scale: scale)
    let selectionRows = grid.rows(picked.minY, picked.maxY)
    let areaRows = area.map { grid.rows($0.minY, $0.maxY) } ?? selectionRows
    let bandRows = selectionRows.clamped(to: areaRows)
    let bandColumns =
      area.map { grid.columns(max(picked.minX, $0.minX), min(picked.maxX, $0.maxX)) }
      ?? (0..<grid.width)
    guard bandRows.count >= 2, bandColumns.count >= 2 else { return nil }
    // The lane is only worth dropping from a band that stays wide without it.
    let lane = min(Int((scrollerLane * scale).rounded(.up)), bandColumns.count / 4)
    let matched = bandColumns.lowerBound..<(bandColumns.upperBound - lane)
    let laneInside = area.map { $0.maxX <= picked.maxX + 0.5 } ?? false
    return LongScreenshotGeometry(
      sourceRect: CGRect(
        x: pixels.minX / scale, y: pixels.minY / scale, width: pixels.width / scale,
        height: pixels.height / scale),
      scale: scale, width: grid.width, height: grid.height, selectionRows: selectionRows,
      areaRows: areaRows, bandRows: bandRows, bandColumns: bandColumns, matchedColumns: matched,
      liveColumns: laneInside ? matched : bandColumns,
      screenRows: max(1, areaRows.count), maxRows: maximumRows(width: grid.width))
  }

  /// The most rows an image `width` pixels wide may have: its export keeps at most
  /// ``LongScreenshotExportRules/maxPixels`` once its width is within
  /// ``LongScreenshotExportRules/maxPixelWidth`` (rows scale with the width), so rows past these
  /// would be scaled away, after costing memory for the whole phase.
  public static func maximumRows(width: Int) -> Int {
    let width = max(1, width)
    let exported = min(width, LongScreenshotExportRules.maxPixelWidth)
    let scale = Double(exported) / Double(width)
    return max(1, Int(Double(LongScreenshotExportRules.maxPixels) / (Double(exported) * scale)))
  }

  /// Rows of the scroll area above the band, which join the image when the page reaches its
  /// start; rows below it, which join at its end.
  public var headRows: Range<Int> { areaRows.lowerBound..<bandRows.lowerBound }
  public var tailRows: Range<Int> { bandRows.upperBound..<areaRows.upperBound }

  /// `pixels` in screens.
  public func screens(_ pixels: Int) -> Double { Double(pixels) / Double(screenRows) }

  /// Point-to-pixel conversion within the stream's pixel rect.
  private struct Grid {
    let origin: CGPoint
    let width: Int
    let height: Int
    let scale: CGFloat

    init(origin: CGPoint, size: CGSize, scale: CGFloat) {
      self.origin = origin
      width = Int(size.width)
      height = Int(size.height)
      self.scale = scale
    }

    func rows(_ top: CGFloat, _ bottom: CGFloat) -> Range<Int> {
      span(top, bottom, origin: origin.y, count: height)
    }

    func columns(_ left: CGFloat, _ right: CGFloat) -> Range<Int> {
      span(left, right, origin: origin.x, count: width)
    }

    /// Whole pixels covering `start..<end` points, as the source rect was widened, within the
    /// stream.
    private func span(_ start: CGFloat, _ end: CGFloat, origin: CGFloat, count: Int) -> Range<Int> {
      let lower = Int((start * scale).rounded(.down) - origin)
      let upper = Int((end * scale).rounded(.up) - origin)
      let clampedLower = min(max(0, lower), count)
      return clampedLower..<min(max(clampedLower, upper), count)
    }
  }
}
