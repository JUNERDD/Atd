import Foundation

/// One of the eight resize handles of a committed selection.
public enum SelectionHandle: CaseIterable, Sendable {
  case topLeft, top, topRight, right, bottomRight, bottom, bottomLeft, left

  /// The x edge the handle moves: -1 the left edge, 1 the right edge, 0 neither.
  var horizontal: Int {
    switch self {
    case .topLeft, .left, .bottomLeft: -1
    case .topRight, .right, .bottomRight: 1
    case .top, .bottom: 0
    }
  }

  /// The y edge the handle moves (view space, y down): -1 the top edge, 1 the bottom edge.
  var vertical: Int {
    switch self {
    case .topLeft, .top, .topRight: -1
    case .bottomLeft, .bottom, .bottomRight: 1
    case .left, .right: 0
    }
  }

  /// The handle moving the given edges; nil for (0, 0), the inside.
  init?(horizontal: Int, vertical: Int) {
    guard
      let handle = Self.allCases.first(where: {
        $0.horizontal == horizontal && $0.vertical == vertical
      })
    else { return nil }
    self = handle
  }

  /// Where the handle sits on `rect`.
  public func point(on rect: CGRect) -> CGPoint {
    CGPoint(
      x: horizontal < 0 ? rect.minX : horizontal > 0 ? rect.maxX : rect.midX,
      y: vertical < 0 ? rect.minY : vertical > 0 ? rect.maxY : rect.midY)
  }
}

/// What a mouse drag does, decided when the button goes down.
public enum SelectionDrag: Equatable, Sendable {
  /// A free selection from `origin`.
  case create(origin: CGPoint)
  /// Moves `original`, grabbed at `grab`.
  case move(grab: CGPoint, original: CGRect)
  /// Moves the edges of `original` that `handle` holds.
  case resize(SelectionHandle, original: CGRect)
}

/// Selection geometry on the capture's desktop (``CaptureDesktop``), in desktop points (origin
/// top-left). A selection stays inside the desktop and may span its displays; its edges sit on
/// the device pixels of the finest display it covers.
public struct SelectionModel: Equatable, Sendable {
  /// One display's area of the desktop and its image pixels per point.
  public struct Display: Equatable, Sendable {
    public let frame: CGRect
    public let scale: CGFloat

    public init(frame: CGRect, scale: CGFloat) {
      self.frame = frame
      self.scale = scale > 0 ? scale : 1
    }
  }

  /// Movement below this distance (points) between button down and up is a click.
  public static let clickTolerance: CGFloat = 4
  /// How far from a handle's center a press still grabs it.
  public static let handleReach: CGFloat = 6

  /// The desktop in its own points: origin zero.
  public let bounds: CGRect
  public let displays: [Display]
  /// The largest image pixels per point of any display.
  public let scale: CGFloat

  public init(bounds: CGRect, displays: [Display]) {
    self.bounds = bounds
    self.displays = displays
    scale = displays.map(\.scale).max() ?? 1
  }

  /// A desktop of one display of `size` points.
  public init(size: CGSize, scale: CGFloat) {
    let bounds = CGRect(origin: .zero, size: size)
    self.init(bounds: bounds, displays: [Display(frame: bounds, scale: scale)])
  }

  /// The pixels per point `rect` snaps to: the finest display it covers, so a selection on one
  /// display crops whole device pixels of it and one spanning displays keeps the finer one's.
  /// An empty rect takes the display under its center; one on no display the finest overall.
  func scale(of rect: CGRect) -> CGFloat {
    let covered = displays.filter {
      let shared = $0.frame.intersection(rect)
      return !shared.isNull && shared.width > 0 && shared.height > 0
    }
    if let finest = covered.map(\.scale).max() { return finest }
    let center = CGPoint(x: rect.midX, y: rect.midY)
    return displays.first { $0.frame.contains(center) }?.scale ?? scale
  }

  /// The smallest side `rect` keeps: one pixel.
  func minimumSide(of rect: CGRect) -> CGFloat { 1 / scale(of: rect) }

  public static func isClick(from start: CGPoint, to end: CGPoint) -> Bool {
    hypot(end.x - start.x, end.y - start.y) < clickTolerance
  }

  public func clamped(_ point: CGPoint) -> CGPoint {
    CGPoint(
      x: min(max(point.x, bounds.minX), bounds.maxX),
      y: min(max(point.y, bounds.minY), bounds.maxY))
  }

  /// What a press at `point` resizes (decision D14): a handle within reach of its dot, the
  /// nearest when two overlap on a tiny selection; otherwise the edge or corner within reach of
  /// the outline (the edge band, inside and outside the selection). Nil away from the outline.
  public func handle(at point: CGPoint, of selection: CGRect) -> SelectionHandle? {
    let dot = SelectionHandle.allCases
      .map { ($0, hypot($0.point(on: selection).x - point.x, $0.point(on: selection).y - point.y)) }
      .filter { $0.1 <= Self.handleReach }
      .min { $0.1 < $1.1 }?.0
    if let dot { return dot }
    let reach = Self.handleReach
    guard selection.insetBy(dx: -reach, dy: -reach).contains(point) else { return nil }
    return SelectionHandle(
      horizontal: Self.nearEdge(point.x, low: selection.minX, high: selection.maxX),
      vertical: Self.nearEdge(point.y, low: selection.minY, high: selection.maxY))
  }

  /// The drag a press at `point` starts: a handle resizes, the inside moves, elsewhere (or
  /// without a selection) a new selection begins.
  public func drag(startingAt point: CGPoint, selection: CGRect?) -> SelectionDrag {
    guard let selection else { return .create(origin: clamped(point)) }
    if let handle = handle(at: point, of: selection) {
      return .resize(handle, original: selection)
    }
    if selection.contains(point) { return .move(grab: point, original: selection) }
    return .create(origin: clamped(point))
  }

  /// The selection while `drag` has reached `point`. `square` (Shift) holds a free selection
  /// to a square from its press point; it has no effect on a move or a resize.
  public func rect(for drag: SelectionDrag, to point: CGPoint, square: Bool = false) -> CGRect {
    let point = clamped(point)
    switch drag {
    case .create(let origin):
      guard square else { return settled(span(origin.x, point.x), span(origin.y, point.y)) }
      let corner = squared(from: origin, to: point)
      return settled(span(corner.origin.x, corner.end.x), span(corner.origin.y, corner.end.y))
    case .move(let grab, let original):
      return placed(original.offsetBy(dx: point.x - grab.x, dy: point.y - grab.y))
    case .resize(let handle, let original):
      let xs =
        switch handle.horizontal {
        case 0: (original.minX, original.maxX)
        case ..<0: span(original.maxX, point.x)
        default: span(original.minX, point.x)
        }
      let ys =
        switch handle.vertical {
        case 0: (original.minY, original.maxY)
        case ..<0: span(original.maxY, point.y)
        default: span(original.minY, point.y)
        }
      return settled(xs, ys)
    }
  }

  /// Where the loupe looks while `drag` has reached `pointer` and the selection is `rect`: the
  /// corner being dragged, or, for an edge, the edge's new position at the pointer's other
  /// coordinate (the midpoint would sit far from a pointer near the edge's end); the pointer
  /// itself while moving. Kept inside the desktop.
  public func loupePoint(for drag: SelectionDrag, rect: CGRect, pointer: CGPoint) -> CGPoint {
    let pointer = clamped(pointer)
    guard case .resize(let handle, _) = drag else { return pointer }
    return CGPoint(
      x: handle.horizontal == 0 ? pointer.x : handle.point(on: rect).x,
      y: handle.vertical == 0 ? pointer.y : handle.point(on: rect).y)
  }

  /// A detected area taken as the selection: cut to the desktop and snapped to pixels.
  public func settled(_ rect: CGRect) -> CGRect {
    let low = clamped(CGPoint(x: rect.minX, y: rect.minY))
    let high = clamped(CGPoint(x: rect.maxX, y: rect.maxY))
    return settled((low.x, high.x), (low.y, high.y))
  }

  /// Arrow keys: moves by `dx`, `dy` points, stopping at the desktop's edges.
  public func nudged(_ rect: CGRect, dx: CGFloat, dy: CGFloat) -> CGRect {
    placed(rect.offsetBy(dx: dx, dy: dy))
  }

  /// Option-arrow keys: moves the right and bottom edges, keeping one pixel and the desktop.
  public func resized(_ rect: CGRect, dWidth: CGFloat, dHeight: CGFloat) -> CGRect {
    let side = minimumSide(of: rect)
    return settled(
      (rect.minX, min(max(rect.maxX + dWidth, rect.minX + side), bounds.maxX)),
      (rect.minY, min(max(rect.maxY + dHeight, rect.minY + side), bounds.maxY)))
  }

  /// Option-Shift-arrow keys: moves the left and top edges by `dx`, `dy` (negative grows the
  /// selection), keeping one pixel and the desktop; the right and bottom edges stay.
  public func resizedLeading(_ rect: CGRect, dx: CGFloat, dy: CGFloat) -> CGRect {
    let side = minimumSide(of: rect)
    return settled(
      (max(min(rect.minX + dx, rect.maxX - side), bounds.minX), rect.maxX),
      (max(min(rect.minY + dy, rect.maxY - side), bounds.minY), rect.maxY))
  }

  // MARK: Helpers

  /// -1 when `value` is within reach of `low`, 1 of `high` (the nearer one on a span narrower
  /// than two reaches), 0 when it is near neither.
  private static func nearEdge(_ value: CGFloat, low: CGFloat, high: CGFloat) -> Int {
    let (toLow, toHigh) = (abs(value - low), abs(value - high))
    guard min(toLow, toHigh) <= handleReach else { return 0 }
    return toLow <= toHigh ? -1 : 1
  }

  /// The opposite corner of the square from `origin` towards `point`: its side is the larger
  /// of the pointer's two offsets, cut to the room left in the drag's direction and counted in
  /// whole pixels of the display under `origin` so both sides snap to the same size.
  private func squared(from origin: CGPoint, to point: CGPoint) -> (origin: CGPoint, end: CGPoint) {
    let scale = scale(of: CGRect(origin: origin, size: .zero))
    let start = CGPoint(
      x: CaptureCoordinates.snap(origin.x, scale: scale),
      y: CaptureCoordinates.snap(origin.y, scale: scale))
    let (dx, dy) = (point.x - start.x, point.y - start.y)
    let toX = dx < 0 ? start.x - bounds.minX : bounds.maxX - start.x
    let toY = dy < 0 ? start.y - bounds.minY : bounds.maxY - start.y
    let side = CaptureCoordinates.snap(min(max(abs(dx), abs(dy)), toX, toY), scale: scale)
    return (
      start, CGPoint(x: start.x + (dx < 0 ? -side : side), y: start.y + (dy < 0 ? -side : side))
    )
  }

  /// The ordered span between a fixed edge and the pointer.
  private func span(_ fixed: CGFloat, _ moving: CGFloat) -> (CGFloat, CGFloat) {
    (min(fixed, moving), max(fixed, moving))
  }

  /// Snaps both spans to the pixels of what they cover and grows a collapsed one to a pixel,
  /// inside the desktop.
  private func settled(_ xs: (CGFloat, CGFloat), _ ys: (CGFloat, CGFloat)) -> CGRect {
    let scale = scale(of: CGRect(x: xs.0, y: ys.0, width: xs.1 - xs.0, height: ys.1 - ys.0))
    let x = widened(snapped(xs, scale: scale), upTo: bounds.maxX, scale: scale)
    let y = widened(snapped(ys, scale: scale), upTo: bounds.maxY, scale: scale)
    return CGRect(x: x.0, y: y.0, width: x.1 - x.0, height: y.1 - y.0)
  }

  /// Keeps the size of `rect` and moves it inside the desktop, on the pixel grid of where it
  /// lands.
  private func placed(_ rect: CGRect) -> CGRect {
    let x = min(max(rect.minX, bounds.minX), bounds.maxX - rect.width)
    let y = min(max(rect.minY, bounds.minY), bounds.maxY - rect.height)
    let scale = scale(of: CGRect(origin: CGPoint(x: x, y: y), size: rect.size))
    let origin = CGPoint(
      x: CaptureCoordinates.snap(x, scale: scale), y: CaptureCoordinates.snap(y, scale: scale))
    return CGRect(origin: origin, size: rect.size)
  }

  private func snapped(_ span: (CGFloat, CGFloat), scale: CGFloat) -> (CGFloat, CGFloat) {
    (CaptureCoordinates.snap(span.0, scale: scale), CaptureCoordinates.snap(span.1, scale: scale))
  }

  private func widened(_ span: (CGFloat, CGFloat), upTo high: CGFloat, scale: CGFloat)
    -> (CGFloat, CGFloat)
  {
    let side = 1 / scale
    guard span.1 - span.0 < side else { return span }
    let end = min(span.0 + side, high)
    return (end - side, end)
  }
}
