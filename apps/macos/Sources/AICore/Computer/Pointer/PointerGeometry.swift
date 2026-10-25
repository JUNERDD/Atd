import Foundation

/// Where the live pointer's pieces go. Everything is in one space, Quartz-like (y down): either
/// Quartz global points or one display's view (``CaptureCoordinates``), as the caller passes it.
public enum PointerGeometry {
  /// Targets up to this size count as controls: the arrow points at their center. Larger ones
  /// (fields, text areas, lists) get it near their leading edge, where their content starts.
  public static let controlSize = CGSize(width: 160, height: 72)
  /// How far into a large target the arrow points.
  public static let leadingInset = CGSize(width: 24, height: 20)

  /// The display a target is drawn on: the index in `displays` (their Quartz bounds) of the one
  /// holding most of it, nil when it misses all of them. A target spanning two displays is drawn
  /// on one only, as the overlay never splits a mark.
  public static func display(for target: CGRect, in displays: [CGRect]) -> Int? {
    var best: (index: Int, area: CGFloat)?
    for (index, display) in displays.enumerated() {
      let cut = target.intersection(display)
      guard !cut.isNull else { continue }
      let area = cut.width * cut.height
      if area > 0, area > (best?.area ?? 0) { best = (index, area) }
    }
    return best?.index
  }

  /// The point the arrow's tip touches for `target` (already cut to its display): the center of a
  /// control, the leading edge of a large target (vertically centered when it is one line high).
  public static func anchor(for target: CGRect) -> CGPoint {
    if target.width <= controlSize.width, target.height <= controlSize.height {
      return CGPoint(x: target.midX, y: target.midY)
    }
    let x = target.minX + min(target.width / 2, leadingInset.width)
    let y =
      target.height <= controlSize.height
      ? target.midY : target.minY + min(target.height / 2, leadingInset.height)
    return CGPoint(x: x, y: y)
  }

  /// The label's origin (its top-left) for an arrow whose tip is at `anchor` and whose body
  /// covers `arrow` below and right of it: beside the arrow's tail, moved to the arrow's left or
  /// above it when it would leave `display`, then kept on it.
  public static func labelOrigin(
    anchor: CGPoint, arrow: CGSize, label: CGSize, display: CGRect
  ) -> CGPoint {
    var x = anchor.x + arrow.width + 2
    var y = anchor.y + arrow.height * 0.8
    if x + label.width > display.maxX { x = anchor.x - 4 - label.width }
    if y + label.height > display.maxY { y = anchor.y - 6 - label.height }
    x = min(max(x, display.minX), max(display.minX, display.maxX - label.width))
    y = min(max(y, display.minY), max(display.minY, display.maxY - label.height))
    return CGPoint(x: x, y: y)
  }
}
