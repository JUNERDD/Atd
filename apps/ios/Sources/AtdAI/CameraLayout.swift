import CoreGraphics

/// Where the camera draws on a photo: the photo fitted into its space, text lines mapped onto it,
/// and labels (translation pins, field tags) placed by the lines they belong to without covering
/// each other or, where there is room, the photo's other text. Pure geometry, so it is tested
/// without views.
public enum CameraLayout {
  /// The largest rect with `size`'s aspect ratio inside `rect`, centered.
  public static func aspectFit(_ size: CGSize, in rect: CGRect) -> CGRect {
    guard size.width > 0, size.height > 0, rect.width > 0, rect.height > 0 else {
      return CGRect(origin: rect.origin, size: .zero)
    }
    let scale = min(rect.width / size.width, rect.height / size.height)
    let fitted = CGSize(width: size.width * scale, height: size.height * scale)
    return CGRect(
      x: rect.midX - fitted.width / 2, y: rect.midY - fitted.height / 2, width: fitted.width,
      height: fitted.height)
  }

  /// A normalized point (top-left origin) on the photo drawn in `photo`.
  public static func point(_ point: CGPoint, in photo: CGRect) -> CGPoint {
    CGPoint(x: photo.minX + point.x * photo.width, y: photo.minY + point.y * photo.height)
  }

  /// A normalized rect on the photo drawn in `photo`.
  public static func rect(_ rect: CGRect, in photo: CGRect) -> CGRect {
    CGRect(
      x: photo.minX + rect.minX * photo.width, y: photo.minY + rect.minY * photo.height,
      width: rect.width * photo.width, height: rect.height * photo.height)
  }

  /// The normalized box around `quads`; nil when there are none.
  public static func bounds(of quads: [CameraQuad]) -> CGRect? {
    guard let first = quads.first else { return nil }
    return quads.dropFirst().reduce(first.bounds) { $0.union($1.bounds) }
  }

  /// The corners of the highlighter stroke under a line: its quad grown by `grow` points on
  /// every side, so the swipe covers the letters' edges.
  public static func swipe(_ quad: CameraQuad, in photo: CGRect, grow: CGFloat = 3) -> [CGPoint] {
    let corners = quad.corners.map { point($0, in: photo) }
    let center = CGPoint(
      x: corners.map(\.x).reduce(0, +) / 4, y: corners.map(\.y).reduce(0, +) / 4)
    return corners.map { corner in
      let dx = corner.x - center.x
      let dy = corner.y - center.y
      let length = max((dx * dx + dy * dy).squareRoot(), 1)
      return CGPoint(x: corner.x + dx / length * grow, y: corner.y + dy / length * grow)
    }
  }

  /// A label to place: the box it belongs to and its own size.
  public struct Label: Sendable, Equatable {
    public var anchor: CGRect
    public var size: CGSize

    public init(anchor: CGRect, size: CGSize) {
      self.anchor = anchor
      self.size = size
    }
  }

  /// Frames for `labels`, in order. Each takes the first free spot of: beside its anchor's
  /// trailing edge (only when `besideFirst`), just below it, just above it. A spot is free when
  /// it lies inside `bounds` and covers no label placed before and no box in `avoiding` (the
  /// photo's text) other than those its own anchor overlaps. Without a free spot a label goes
  /// below its anchor, moved down past labels already placed, or above it (moved up) when that
  /// would leave `bounds` at the bottom, kept inside `bounds` as far as its size allows.
  public static func place(
    _ labels: [Label], in bounds: CGRect, avoiding text: [CGRect] = [], besideFirst: Bool = false,
    gap: CGFloat = 4
  ) -> [CGRect] {
    var placed: [CGRect] = []
    for label in labels {
      let obstacles = placed + text.filter { !$0.intersects(label.anchor) }
      let free = spots(for: label, in: bounds, gap: gap, besideFirst: besideFirst).first { spot in
        bounds.contains(spot) && !obstacles.contains { $0.intersects(spot) }
      }
      placed.append(free ?? stacked(label, in: bounds, among: placed, gap: gap))
    }
    return placed
  }

  /// Where a label may go, in the order it is tried.
  private static func spots(for label: Label, in bounds: CGRect, gap: CGFloat, besideFirst: Bool)
    -> [CGRect]
  {
    let anchor = label.anchor
    let size = label.size
    let x = clamp(anchor.minX, bounds.minX, bounds.maxX - size.width)
    let below = CGRect(origin: CGPoint(x: x, y: anchor.maxY + gap), size: size)
    let above = CGRect(origin: CGPoint(x: x, y: anchor.minY - gap - size.height), size: size)
    let beside = CGRect(
      origin: CGPoint(x: anchor.maxX + gap, y: anchor.midY - size.height / 2), size: size)
    return besideFirst ? [beside, below, above] : [below, above]
  }

  /// Below the anchor past the labels already placed, or above it when that leaves `bounds`.
  private static func stacked(
    _ label: Label, in bounds: CGRect, among placed: [CGRect], gap: CGFloat
  ) -> CGRect {
    let x = clamp(label.anchor.minX, bounds.minX, bounds.maxX - label.size.width)
    var frame = CGRect(origin: CGPoint(x: x, y: label.anchor.maxY + gap), size: label.size)
    frame = settle(frame, among: placed, step: gap, downward: true)
    if frame.maxY > bounds.maxY {
      frame.origin.y = label.anchor.minY - gap - label.size.height
      frame = settle(frame, among: placed, step: gap, downward: false)
    }
    frame.origin.y = clamp(frame.minY, bounds.minY, bounds.maxY - frame.height)
    return frame
  }

  /// `value` within `low...high`; `low` when the range is empty.
  private static func clamp(_ value: CGFloat, _ low: CGFloat, _ high: CGFloat) -> CGFloat {
    min(max(value, low), max(high, low))
  }

  /// Moves `frame` down (or up) until it overlaps none of `placed`.
  private static func settle(_ frame: CGRect, among placed: [CGRect], step: CGFloat, downward: Bool)
    -> CGRect
  {
    var frame = frame
    // Each pass clears one overlap; as many passes as labels is enough.
    for _ in 0...placed.count {
      guard let hit = placed.first(where: { $0.intersects(frame) }) else { break }
      frame.origin.y = downward ? hit.maxY + step : hit.minY - step - frame.height
    }
    return frame
  }
}
