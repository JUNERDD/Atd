import CoreGraphics

/// The long screenshot's lightbox geometry (the result preview's direction A, `P.LB.openLong` and
/// `P.viewer` in the approved prototype): the whole image in a vertical scroller that fills the
/// window's height left of an overview rail, centred in its column with a gutter beside it and
/// room above and below it for the bars, at a zoom between 25% and 200%.
///
/// The scroller's position is its top-left corner in image points (an `NSClipView`'s bounds
/// origin) at a zoom (screen points per image point). The viewer constrains every position it
/// takes through ``constrain(_:zoom:view:)`` and the lightbox works out where the image opens with
/// the same rules, so its motion lands where the viewer shows the image. All rectangles are in the
/// lightbox's coordinates (the screen's frame, top-left origin) unless they say otherwise.
public struct LongScreenshotLightboxLayout: Equatable, Sendable {
  /// The window: the whole screen.
  public let size: CGSize
  /// The screen's work area inside it; the bars and the rail stay inside it.
  public let workArea: CGRect
  /// The image's size in points.
  public let image: CGSize

  public init(size: CGSize, workArea: CGRect, image: CGSize) {
    self.size = size
    self.workArea = workArea
    self.image = CGSize(width: max(image.width, 1), height: max(image.height, 1))
  }

  /// Beside the image, at least, at any zoom (screen points).
  public static let gutter = 56.0
  /// Above the image's top below the work area's top edge, and below its bottom above the work
  /// area's bottom edge: the room the top and bottom bars take, with air.
  public static let padTop = 76.0
  public static let padBottom = 96.0
  /// The part of the scroller the bars leave free, from the work area's edges: what the rail's
  /// viewport and the page counter call visible.
  public static let visibleTop = 68.0
  public static let visibleBottom = 80.0
  /// The overview rail: its width, and its insets from the work area's top, bottom and right.
  public static let railWidth = 120.0
  public static let railTop = 76.0
  public static let railBottom = 92.0
  public static let railRight = 22.0
  /// The zoom's range and the steps − and + move through.
  public static let minZoom = 0.25
  public static let maxZoom = 2.0
  public static let zoomSteps: [CGFloat] = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2]
  /// ↑ and ↓ scroll this far (screen points).
  public static let arrowScroll = 90.0
  /// A point opened at stands this far down the scroller (a share of its height): about a third.
  public static let startShare = 0.38
  /// A page or the kept range's top scrolled to stands this far below the visible top.
  public static let landing = 12.0
  /// A trim bar dragged within this distance of the visible region's edges scrolls the image, by
  /// half the distance into it per frame and at most ``autoscrollStep`` (screen points).
  public static let autoscrollEdge = 28.0
  public static let autoscrollStep = 26.0

  // MARK: Regions

  /// The scroller: the window's whole height, the work area's width less the rail's column.
  public var column: CGRect {
    let right = workArea.maxX - Self.railWidth - Self.railRight * 2
    return CGRect(x: workArea.minX, y: 0, width: max(right - workArea.minX, 1), height: size.height)
  }

  /// The overview rail's box; its image is ``railImage``.
  public var rail: CGRect {
    CGRect(
      x: workArea.maxX - Self.railRight - Self.railWidth, y: workArea.minY + Self.railTop,
      width: Self.railWidth,
      height: max(workArea.height - Self.railTop - Self.railBottom, 1))
  }

  /// Rail points per image point: the whole image fits the rail.
  public var railScale: CGFloat {
    min(Self.railWidth / image.width, rail.height / image.height)
  }

  /// The whole image on the rail: centred across it, at its top.
  public var railImage: CGRect {
    let width = image.width * railScale
    return CGRect(
      x: rail.midX - width / 2, y: rail.minY, width: width, height: image.height * railScale)
  }

  /// The room above and below the image in the scroller (screen points from its edges).
  public var padding: (top: CGFloat, bottom: CGFloat) {
    (workArea.minY - column.minY + Self.padTop, column.maxY - workArea.maxY + Self.padBottom)
  }

  /// The part of the scroller between the bars (screen points from its edges).
  public var visibleInsets: (top: CGFloat, bottom: CGFloat) {
    (
      workArea.minY - column.minY + Self.visibleTop,
      column.maxY - workArea.maxY + Self.visibleBottom
    )
  }

  // MARK: Zoom

  public static func clamp(zoom: CGFloat) -> CGFloat { min(max(zoom, minZoom), maxZoom) }

  /// The image's width fitted between the gutters.
  public var fitZoom: CGFloat { Self.clamp(zoom: (column.width - Self.gutter * 2) / image.width) }

  /// Where it opens: 100% when the image fits the column at its own size, otherwise fitted.
  public var initialZoom: CGFloat { fitZoom >= 1 ? 1 : fitZoom }

  /// The next step in from `zoom`, or the largest.
  public static func zoomIn(from zoom: CGFloat) -> CGFloat {
    zoomSteps.first { $0 > zoom + 0.01 } ?? maxZoom
  }

  /// The next step out from `zoom`, or the smallest.
  public static func zoomOut(from zoom: CGFloat) -> CGFloat {
    zoomSteps.last { $0 < zoom - 0.01 } ?? minZoom
  }

  // MARK: Position

  /// `origin` (image points) moved where the scroller may stand at `zoom` with a viewport of
  /// `view` (screen points): centred across while the image and its gutters are narrower than
  /// the view, otherwise within the gutters; within the room above and below, at the top while
  /// the image and its room are shorter than the view.
  public func constrain(_ origin: CGPoint, zoom: CGFloat, view: CGSize) -> CGPoint {
    let zoom = max(zoom, 0.0001)
    let width = view.width / zoom
    let height = view.height / zoom
    let gutter = Self.gutter / zoom
    let x =
      image.width + gutter * 2 <= width
      ? (image.width - width) / 2
      : min(max(origin.x, -gutter), image.width + gutter - width)
    let pad = padding
    let lowest = -pad.top / zoom
    let highest = image.height + pad.bottom / zoom - height
    let y = highest < lowest ? lowest : min(max(origin.y, lowest), highest)
    return CGPoint(x: x, y: y)
  }

  /// Where the scroller stands at `zoom` with image row `y` `offset` screen points below its top,
  /// centred across.
  public func origin(showing y: CGFloat, at offset: CGFloat, zoom: CGFloat) -> CGPoint {
    constrain(
      CGPoint(x: (image.width - column.width / zoom) / 2, y: y - offset / zoom), zoom: zoom,
      view: column.size)
  }

  /// Where it opens: image row `start` about a third down the scroller, or else the kept range's
  /// `top` just below the top bar.
  public func openingOrigin(start: CGFloat?, top: CGFloat, zoom: CGFloat) -> CGPoint {
    if let start { return origin(showing: start, at: column.height * Self.startShare, zoom: zoom) }
    return origin(showing: top, at: visibleInsets.top + Self.landing, zoom: zoom)
  }

  /// The whole image's frame with the scroller at `origin` and `zoom`.
  public func imageFrame(origin: CGPoint, zoom: CGFloat) -> CGRect {
    CGRect(
      x: column.minX - origin.x * zoom, y: column.minY - origin.y * zoom,
      width: image.width * zoom, height: image.height * zoom)
  }

  /// The image rows between the bars with the scroller at `origin` and `zoom`, within the image.
  public func visible(origin: CGPoint, zoom: CGFloat, view: CGSize) -> ClosedRange<CGFloat> {
    let insets = visibleInsets
    let top = min(max(origin.y + insets.top / zoom, 0), image.height)
    let bottom = min(max(origin.y + (view.height - insets.bottom) / zoom, top), image.height)
    return top...bottom
  }

  /// The scroller's top (image points) that shows `visible`'s top at the visible region's top.
  public func originY(visibleTop: CGFloat, zoom: CGFloat) -> CGFloat {
    visibleTop - visibleInsets.top / zoom
  }

  /// How far to scroll a trim bar's drag this frame with the pointer at `y` (screen points from
  /// the scroller's top) in a scroller `height` tall: up near the visible top, down near the
  /// visible bottom, nothing between.
  public func autoscroll(pointer y: CGFloat, height: CGFloat) -> CGFloat {
    let insets = visibleInsets
    let upper = insets.top + Self.autoscrollEdge
    let lower = height - insets.bottom - Self.autoscrollEdge
    if y < upper { return -min(Self.autoscrollStep, (upper - y) / 2) }
    if y > lower { return min(Self.autoscrollStep, (y - lower) / 2) }
    return 0
  }

  /// The page the counter names for `visible` rows: the one a third of the way down them, or
  /// the nearest; nil without pages.
  public static func currentPage(_ visible: ClosedRange<CGFloat>, pages: [LongScreenshotCardPage])
    -> Int?
  {
    guard let last = pages.indices.last else { return nil }
    let y = visible.lowerBound + (visible.upperBound - visible.lowerBound) * 0.35
    return min(pages.lastIndex { $0.top <= y } ?? 0, last)
  }
}

extension IslandMetrics {
  /// The card preview's full-screen button: a disc in the box's top-right corner.
  public static let longScreenshotOpenButton = 24.0
}
