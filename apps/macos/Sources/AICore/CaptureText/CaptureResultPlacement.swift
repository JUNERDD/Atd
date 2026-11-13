import CoreGraphics

/// Where a text command's floating result card (and the capsule it collapses into) sits in the
/// capture editor (decision D1), in logical points with the origin at the top-left and y down; any
/// origin works, negative ones included (a display left of or above the main one). The long
/// screenshot's full-screen preview shows the card's content in its side panel instead
/// (``IslandMetrics/lightboxPanel(shown:in:between:)``), as wide as the card.
public enum CaptureResultPlacement {
  /// The gap between the card and what it sits beside.
  public static let gap: CGFloat = 14
  /// The least room kept between the card and the edge of the area it stays in.
  public static let margin: CGFloat = 8
  /// The card's width, and the lightbox panel's; the card's height follows its content up to the
  /// island's largest shape (``IslandMetrics/maxShape``), past which its body scrolls.
  public static let cardWidth: CGFloat = 352

  /// The side of the selection the capture editor's card stands on.
  public enum Side: Sendable, CaseIterable {
    case right, left, below, above
  }

  /// The capture editor's card beside `selection` without covering it or `bars` (the toolbar and
  /// its second row), inside `workArea` (the display's visible frame): right of the selection with
  /// their tops aligned, sliding only as far as the work area's edge or bars reaching past the
  /// selection's edge need, else left of it, else below the selection and the bars, else above
  /// them, the first side with room for the tallest card (the island's largest shape), so a card
  /// that grows as its answer lands still fits there; else the side with the most room. A side
  /// counts only with room for `minimumHeight` (the card's fixed parts and a little of its body).
  /// The card keeps the side it stood on (`kept`) while that side counts, and also when no side
  /// does, so it never jumps to another side as it grows. On a side shorter than the card it is
  /// cut to the room there, its body scrolling, though never below `minimumHeight`: a side
  /// shorter than that leaves the card over the edge of what it sits beside by the difference. A
  /// new card where no side counts (a selection filling the display) stays at the work area's
  /// bottom-right corner, over the selection, and has no side.
  public static func capture(
    size: CGSize, minimumHeight: CGFloat, selection: CGRect, bars: CGRect?, workArea: CGRect,
    keeping kept: Side?
  ) -> (frame: CGRect, side: Side?) {
    let area = workArea.insetBy(dx: margin, dy: margin)
    let blocked = [selection] + (bars.map { [$0] } ?? [])
    let footprint = blocked.reduce(CGRect.null) { $0.union($1) }
    func clampedX(_ x: CGFloat) -> CGFloat {
      min(max(x, area.minX), max(area.maxX - size.width, area.minX))
    }
    /// The vertical span a side leaves the card, top to bottom: beside the selection, its column
    /// down the work area, cut short by bars standing above or below the selection in that
    /// column (they may reach past the selection's edge); below or above, between the selection
    /// and its bars and the work area's edge. Nil beside the selection where the card, kept
    /// inside the work area, would slide over it, or where bars stand level with the selection's
    /// top in its column.
    func span(_ side: Side) -> (x: CGFloat, top: CGFloat, bottom: CGFloat)? {
      switch side {
      case .right, .left:
        let x = clampedX(
          side == .right ? selection.maxX + gap : selection.minX - gap - size.width)
        let column = (min: x, max: x + size.width)
        guard column.max <= selection.minX || column.min >= selection.maxX else { return nil }
        var top = area.minY
        var bottom = area.maxY
        if let bars, bars.minX < column.max, bars.maxX > column.min {
          if bars.maxY <= selection.minY {
            top = max(top, bars.maxY + gap)
          } else if bars.minY >= selection.minY {
            bottom = min(bottom, bars.minY - gap)
          } else {
            return nil
          }
        }
        return (x, top, bottom)
      case .below: return (clampedX(selection.minX), footprint.maxY + gap, area.maxY)
      case .above: return (clampedX(selection.minX), area.minY, footprint.minY - gap)
      }
    }
    /// The card `height` tall on `side`: beside the selection with their tops aligned, sliding
    /// only as far as its span needs; below the bars from their edge, above them up to it. A card
    /// taller than its span keeps the span's start and passes its end by the difference, always
    /// inside the work area.
    func frame(_ side: Side, height: CGFloat) -> CGRect? {
      guard let span = span(side) else { return nil }
      let preferred =
        switch side {
        case .right, .left: max(span.top, min(selection.minY, span.bottom - height))
        case .below: span.top
        case .above: max(span.top, span.bottom - height)
        }
      let y = min(max(preferred, area.minY), max(area.maxY - height, area.minY))
      return CGRect(x: span.x, y: y, width: size.width, height: height)
    }
    /// The height a side leaves the card; nil where the side does not count at all (``span``).
    func room(_ side: Side) -> CGFloat? {
      span(side).map { $0.bottom - $0.top }
    }
    let rooms = Side.allCases.compactMap { side in room(side).map { (side: side, room: $0) } }
    let least = min(minimumHeight, size.height)
    let tallest = min(IslandMetrics.maxShape.height, area.height)
    let usable = rooms.filter { $0.room >= least }
    let chosen =
      usable.first { $0.side == kept } ?? usable.first { $0.room >= tallest }
      ?? usable.max { $0.room < $1.room } ?? rooms.first { $0.side == kept }
    let height = min(size.height, max(chosen?.room ?? 0, least))
    guard let chosen, let placed = frame(chosen.side, height: height) else {
      let corner = CGRect(
        x: clampedX(area.maxX), y: max(area.maxY - size.height, area.minY), width: size.width,
        height: size.height)
      return (corner, nil)
    }
    return (placed, chosen.side)
  }

  /// A capsule `size` large standing where the card `card` stood, at its top-left corner, kept
  /// inside `area`.
  public static func capsule(size: CGSize, at card: CGRect, in area: CGRect) -> CGRect {
    let inner = area.insetBy(dx: margin, dy: margin)
    return CGRect(
      x: min(max(card.minX, inner.minX), max(inner.maxX - size.width, inner.minX)),
      y: min(max(card.minY, inner.minY), max(inner.maxY - size.height, inner.minY)),
      width: size.width, height: size.height)
  }
}
