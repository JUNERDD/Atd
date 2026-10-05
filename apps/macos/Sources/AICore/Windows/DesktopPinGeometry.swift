/// Where desktop pins go, in AppKit's y-up global coordinates (points), so displays left of or
/// below the primary one, at negative coordinates, work like any other. A pin's place is kept as
/// the offset of its top-left corner from its display's work-area top-left: a pin stays put when
/// the Dock or the menu bar changes the work area, and returns to the same spot on its display.
public enum DesktopPinGeometry {
  /// The margin a click-to-pin leaves to the work area's edges, and between pins.
  public static let inset = 16.0
  public static let gap = 16.0
  /// How far each pin cascades from the last when no free place fits.
  public static let cascade = 24.0
  /// How far a press must travel before it moves a pin rather than clicking it.
  public static let moveThreshold = 3.0
  /// How far from a pin's corner a press resizes the pin rather than moving it.
  public static let resizeCorner = 20.0

  /// A pin's corner. A press there resizes the pin while the opposite corner stays put.
  public enum Corner: CaseIterable, Equatable, Sendable {
    case topLeft
    case topRight
    case bottomLeft
    case bottomRight

    public var isLeft: Bool { self == .topLeft || self == .bottomLeft }
    public var isTop: Bool { self == .topLeft || self == .topRight }
  }

  /// A pin's top-left corner relative to its work area's top-left: `x` to the right, `y` down.
  public struct Offset: Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
      self.x = x
      self.y = y
    }
  }

  /// The frame at `offset` in `workArea`, moved and shrunk to fit inside it.
  public static func frame(offset: Offset, size: WindowSize, in workArea: ScreenRect)
    -> ScreenRect
  {
    let frame = ScreenRect(
      x: workArea.x + offset.x, y: workArea.maxY - offset.y - size.height, width: size.width,
      height: size.height)
    return PanelGeometry.constrain(frame, to: workArea)
  }

  public static func offset(of frame: ScreenRect, in workArea: ScreenRect) -> Offset {
    Offset(x: frame.x - workArea.x, y: workArea.maxY - frame.maxY)
  }

  /// A pin of `size` centered on a point (where a drag dropped it), kept inside `workArea`.
  public static func centered(x: Double, y: Double, size: WindowSize, in workArea: ScreenRect)
    -> ScreenRect
  {
    let frame = ScreenRect(
      x: (x - size.width / 2).rounded(), y: (y - size.height / 2).rounded(), width: size.width,
      height: size.height)
    return PanelGeometry.constrain(frame, to: workArea)
  }

  /// Whether a press that travelled this far moves the pin.
  public static func isMove(dx: Double, dy: Double) -> Bool {
    dx * dx + dy * dy > moveThreshold * moveThreshold
  }

  /// The corner a point of a pin of `size` lies on, in the pin's own y-up coordinates from its
  /// bottom-left corner: within ``resizeCorner`` of it on both axes, and on the card, whose
  /// corners are rounded with `radius`. Nil elsewhere, the rounded-off tips included: they show
  /// the desktop and pass presses through to it, so they are no part of the pin.
  public static func corner(atX x: Double, y: Double, size: WindowSize, radius: Double)
    -> Corner?
  {
    guard x >= 0, y >= 0, x <= size.width, y <= size.height else { return nil }
    let (isLeft, isTop) = (x <= size.width - x, size.height - y < y)
    // How far the point lies in from the corner's two edges.
    let (inX, inY) = (isLeft ? x : size.width - x, isTop ? size.height - y : y)
    guard inX <= resizeCorner, inY <= resizeCorner else { return nil }
    // The rounding is an arc centered `radius` in from both edges; a point past that center on
    // either axis is on the card regardless.
    let (dx, dy) = (max(0, radius - inX), max(0, radius - inY))
    guard dx * dx + dy * dy <= radius * radius else { return nil }
    return isTop ? (isLeft ? .topLeft : .topRight) : (isLeft ? .bottomLeft : .bottomRight)
  }

  // MARK: Free size

  /// How close a resize comes to one of a pin's declared sizes, in points on both axes, before it
  /// takes that size exactly: a gentle magnet, so Small, Medium and Large are easy to land on.
  public static let magnet = 8.0

  /// The sizes one of a pin's layouts handles well: `min` to `max` on each axis.
  public struct SizeRange: Equatable, Sendable {
    public var min: WindowSize
    public var max: WindowSize

    public init(min: WindowSize, max: WindowSize) {
      self.min = min
      self.max = max
    }

    public func contains(_ size: WindowSize) -> Bool {
      size.width >= min.width && size.width <= max.width && size.height >= min.height
        && size.height <= max.height
    }

    /// The size nearest `size` that this range holds.
    public func clamp(_ size: WindowSize) -> WindowSize {
      WindowSize(
        width: Swift.min(Swift.max(size.width, min.width), max.width),
        height: Swift.min(Swift.max(size.height, min.height), max.height))
    }
  }

  /// `size` when one of `ranges` holds it, else the nearest size one does (the first of equals).
  /// Together the ranges need not make a rectangle: sizes no layout handles well stay out.
  public static func clamp(_ size: WindowSize, to ranges: [SizeRange]) -> WindowSize {
    let held = ranges.map { $0.clamp(size) }
    return held.min { distance(size, $0) < distance(size, $1) } ?? size
  }

  /// Of `ranges`, listed from the smallest layout up, the index of the layout a pin of `size`
  /// shows: the last range that holds it, so the larger layout wins where ranges meet. Nil when
  /// none does.
  public static func layout(of size: WindowSize, among ranges: [SizeRange]) -> Int? {
    ranges.indices.last { ranges[$0].contains(size) }
  }

  /// A resize from `corner` of `frame` by the pointer's travel since the press (`dx`, `dy`, y
  /// up): that corner follows the pointer while the opposite one stays put, the size kept to
  /// `ranges` and to the room the work area leaves on the dragged sides, and taking one of
  /// `magnets` exactly once within ``magnet`` of it. The frame is then kept inside `workArea`,
  /// which moves the held corner only when the smallest size allowed does not fit.
  public static func resize(
    _ frame: ScreenRect, from corner: Corner, by dx: Double, _ dy: Double,
    ranges: [SizeRange], magnets: [WindowSize], in workArea: ScreenRect
  ) -> ScreenRect {
    // The opposite corner, which stays put: the right edge for a left corner, the bottom for a
    // top one (`y` is the bottom edge in these y-up coordinates).
    let anchorX = corner.isLeft ? frame.maxX : frame.x
    let anchorY = corner.isTop ? frame.y : frame.maxY
    let room = WindowSize(
      width: corner.isLeft ? anchorX - workArea.x : workArea.maxX - anchorX,
      height: corner.isTop ? workArea.maxY - anchorY : anchorY - workArea.y)
    let asked = WindowSize(
      width: min(frame.width + (corner.isLeft ? -dx : dx), room.width),
      height: min(frame.height + (corner.isTop ? dy : -dy), room.height))
    var size = clamp(asked, to: ranges)
    let pull = magnets.first { candidate in
      abs(candidate.width - size.width) <= magnet && abs(candidate.height - size.height) <= magnet
        && candidate.width <= room.width && candidate.height <= room.height
    }
    if let pull { size = pull }
    let resized = ScreenRect(
      x: corner.isLeft ? anchorX - size.width : anchorX,
      y: corner.isTop ? anchorY : anchorY - size.height, width: size.width, height: size.height)
    return PanelGeometry.constrain(resized, to: workArea)
  }

  private static func distance(_ one: WindowSize, _ other: WindowSize) -> Double {
    let (dw, dh) = (one.width - other.width, one.height - other.height)
    return dw * dw + dh * dh
  }

  /// Where a new pin of `size` goes: the first free place column by column from the work area's
  /// top-left, ``inset`` from its edges and ``gap`` from every pin in `occupied`. Places line up
  /// with the work area's corner and the edges of the pins already there. When none fits, the pin
  /// cascades from the top-left corner, ``cascade`` points further for each pin already sitting
  /// on a cascade step.
  public static func freeSlot(size: WindowSize, in workArea: ScreenRect, occupied: [ScreenRect])
    -> ScreenRect
  {
    let lefts = Set([workArea.x + inset] + occupied.map { $0.maxX + gap }).sorted()
    let tops = Set([workArea.maxY - inset] + occupied.map { $0.y - gap }).sorted(by: >)
    for left in lefts {
      for top in tops {
        let candidate = ScreenRect(
          x: left, y: top - size.height, width: size.width, height: size.height)
        if fits(candidate, in: workArea), !occupied.contains(where: { near(candidate, $0) }) {
          return candidate
        }
      }
    }
    let origin = (x: workArea.x + inset, top: workArea.maxY - inset)
    var step = 0.0
    while occupied.contains(where: {
      abs($0.x - (origin.x + step)) < 1 && abs($0.maxY - (origin.top - step)) < 1
    }) {
      step += cascade
    }
    let frame = ScreenRect(
      x: origin.x + step, y: origin.top - step - size.height, width: size.width,
      height: size.height)
    return PanelGeometry.constrain(frame, to: workArea)
  }

  /// Inside the work area with ``inset`` to spare on every side.
  private static func fits(_ rect: ScreenRect, in workArea: ScreenRect) -> Bool {
    rect.x >= workArea.x + inset && rect.maxX <= workArea.maxX - inset
      && rect.y >= workArea.y + inset && rect.maxY <= workArea.maxY - inset
  }

  /// Closer than ``gap`` to `other`, overlaps included.
  private static func near(_ rect: ScreenRect, _ other: ScreenRect) -> Bool {
    !(rect.maxX + gap <= other.x || other.maxX + gap <= rect.x
      || rect.maxY + gap <= other.y || other.maxY + gap <= rect.y)
  }
}
