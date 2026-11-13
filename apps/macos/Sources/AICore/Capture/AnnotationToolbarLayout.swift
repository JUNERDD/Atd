import CoreGraphics
import Foundation

/// Where the annotation toolbar and its second row (the style bar or the screenshot's command
/// row) sit beside the selection, in the overlay view's flipped points (y down); the record bar
/// is placed the same way, alone
/// (``frames(bar:beside:within:keepClear:holding:gap:margin:)``). The two stack as one block,
/// the second row on the toolbar's side away from the selection, `stack` apart, leading edges
/// aligned, and the block keeps clear of the session's bottom bar and the selection's size label
/// (``KeepClear``, architecture C4):
///
/// - Below the selection, `gap` under it, toolbar right-aligned to it, when that fits.
/// - Above it, the same `gap` over it; ``sizeLabelReach`` higher only where the block would
///   cover the size label.
/// - Either way, when the block would cover the bar (inflated by `gap`), it slides sideways just
///   past it as long as it still overlaps the selection horizontally; otherwise that side fails.
/// - Inside the selection's bottom edge as the last resort (a selection that fills the display),
///   the second row then above the toolbar, moved up or down off the bar.
///
/// The second row's room is kept even while it is hidden, so the toolbar never jumps as it
/// appears. While the selection is dragged, the place the block took stays as long as it fits
/// (``Anchor``). Everything stays `margin` inside the display. Once the user drags the bars,
/// ``frames(toolbar:styleBar:at:within:stack:margin:)`` places them instead.
public enum AnnotationToolbarLayout {
  /// Room the overlay's "W × H" label takes above a selection (`CaptureChromeView`: a badge about
  /// 23 pt tall, 6 pt above the edge). A block placed above rises by it only to clear the label.
  public static let sizeLabelReach: CGFloat = 30

  /// What the block must not cover, in the same points as the selection.
  public struct KeepClear: Equatable, Sendable {
    /// The session's bottom bar; `gap` around it stays clear too.
    public var bar: CGRect?
    /// The selection's size label (``CaptureSizeLabelLayout``); `gap` beside it stays clear.
    public var label: CGRect?

    public init(bar: CGRect? = nil, label: CGRect? = nil) {
      self.bar = bar
      self.label = label
    }
  }

  /// Which place of the rule the block took: its side of the selection and, beside the bar,
  /// which way it slid. Handed back as `holding` while the selection is being dragged, it keeps
  /// the block there for as long as it still fits there, sliding the same way, and the block
  /// leaves it only once it no longer fits; a settled selection is placed afresh. Without it,
  /// an edge trembling where one place stops fitting would flip the block between places far
  /// apart on every pointer move.
  public struct Anchor: Equatable, Sendable {
    public enum Side: Sendable {
      /// `gap` under the selection.
      case below
      /// `gap` over the selection.
      case above
      /// Over the selection, risen ``sizeLabelReach`` past its size label.
      case raised
      /// Inside the selection's bottom edge.
      case inside
    }

    /// Past the bar's trailing or leading edge.
    public enum Slide: Sendable {
      case trailing, leading
    }

    public let side: Side
    /// Nil where the block did not have to slide.
    public let slide: Slide?
  }

  /// The block's frames and the place they took.
  public struct Placement: Equatable, Sendable {
    public let toolbar: CGRect
    public let styleBar: CGRect
    public let anchor: Anchor
  }

  /// The toolbar's and the second row's columns for one toolbar position: the second row keeps
  /// the toolbar's leading edge unless that leaves the display.
  private struct Columns {
    let toolbarX: CGFloat
    let styleX: CGFloat
    let left: CGFloat
    let right: CGFloat
  }

  public static func frames(
    toolbar: CGSize, styleBar: CGSize, beside selection: CGRect, within display: CGRect,
    keepClear: KeepClear = KeepClear(), holding held: Anchor? = nil, gap: CGFloat = 8,
    stack: CGFloat = 6, margin: CGFloat = 8
  ) -> Placement {
    let block = toolbar.height + stack + styleBar.height
    let minX = display.minX + margin
    let maxX = display.maxX - margin
    func columns(_ toolbarX: CGFloat) -> Columns {
      let styleX = clamp(toolbarX, minX, maxX - styleBar.width)
      return Columns(
        toolbarX: toolbarX, styleX: styleX, left: min(toolbarX, styleX),
        right: max(toolbarX + toolbar.width, styleX + styleBar.width))
    }
    let preferred = columns(clamp(selection.maxX - toolbar.width, minX, maxX - toolbar.width))
    let keepOut = keepClear.bar?.insetBy(dx: -gap, dy: -gap)
    let label = keepClear.label?.insetBy(dx: -gap, dy: 0)
    func area(_ columns: Columns, _ y: CGFloat) -> CGRect {
      CGRect(x: columns.left, y: y, width: columns.right - columns.left, height: block)
    }
    func hits(_ columns: Columns, _ y: CGFloat) -> Bool {
      keepOut.map { area(columns, y).intersects($0) } ?? false
    }
    func covers(_ columns: Columns, _ y: CGFloat) -> Bool {
      label.map { area(columns, y).intersects($0) } ?? false
    }
    // The columns at `y` that clear the bar and the label: the preferred ones, else slid just
    // past the bar, the way `slide` names while that way works, else the nearer one; nil when
    // no way keeps the block beside the selection.
    func fit(_ y: CGFloat, sliding slide: Anchor.Slide?) -> (
      columns: Columns, slide: Anchor.Slide?
    )? {
      if covers(preferred, y) { return nil }
      guard let keepOut, hits(preferred, y) else { return (preferred, nil) }
      let width = preferred.right - preferred.left
      let ways = [(Anchor.Slide.trailing, keepOut.maxX), (.leading, keepOut.minX - width)]
        .map { (columns: columns(preferred.toolbarX + $0.1 - preferred.left), slide: $0.0) }
        .filter { way in
          let next = way.columns
          return next.left >= minX && next.right <= maxX && next.left < selection.maxX
            && next.right > selection.minX && !hits(next, y) && !covers(next, y)
        }
      let nearest = ways.min {
        abs($0.columns.left - preferred.left) < abs($1.columns.left - preferred.left)
      }
      guard let way = ways.first(where: { $0.slide == slide }) ?? nearest else { return nil }
      return (way.columns, way.slide)
    }
    // The block on `side` beside the selection, nil where it does not fit there.
    func beside(_ side: Anchor.Side, sliding slide: Anchor.Slide?) -> Placement? {
      // The block's top edge.
      let top: CGFloat
      switch side {
      case .below:
        top = selection.maxY + gap
        guard top + block <= display.maxY - margin else { return nil }
      case .above, .raised:
        top = selection.minY - (side == .raised ? sizeLabelReach : 0) - gap - block
        guard top >= display.minY + margin else { return nil }
      case .inside:
        return nil
      }
      guard let fitted = fit(top, sliding: slide) else { return nil }
      // The second row is on the toolbar's side away from the selection.
      let toolbarY = side == .below ? top : top + styleBar.height + stack
      let styleY = side == .below ? top + toolbar.height + stack : top
      return Placement(
        toolbar: CGRect(origin: CGPoint(x: fitted.columns.toolbarX, y: toolbarY), size: toolbar),
        styleBar: CGRect(origin: CGPoint(x: fitted.columns.styleX, y: styleY), size: styleBar),
        anchor: Anchor(side: side, slide: fitted.slide))
    }
    // Inside the selection's bottom edge, the second row above the toolbar, off the bar.
    func inside() -> Placement {
      var y = clamp(
        selection.maxY - gap - toolbar.height, display.minY + margin + styleBar.height + stack,
        display.maxY - margin - toolbar.height)
      var top = y - stack - styleBar.height
      if let keepOut, hits(preferred, top) {
        top = keepOut.minY > top ? keepOut.minY - block : keepOut.maxY
        y = top + styleBar.height + stack
      }
      return Placement(
        toolbar: CGRect(origin: CGPoint(x: preferred.toolbarX, y: y), size: toolbar),
        styleBar: CGRect(origin: CGPoint(x: preferred.styleX, y: top), size: styleBar),
        anchor: Anchor(side: .inside, slide: nil))
    }
    if let held {
      if held.side == .inside { return inside() }
      if let kept = beside(held.side, sliding: held.slide) { return kept }
    }
    return [Anchor.Side.below, .above, .raised].lazy.compactMap { beside($0, sliding: nil) }
      .first ?? inside()
  }

  /// One bar on its own (the record bar), placed by the same rule as the toolbar's block: its
  /// frame is the placement's `toolbar`.
  public static func frames(
    bar: CGSize, beside selection: CGRect, within display: CGRect,
    keepClear: KeepClear = KeepClear(), holding held: Anchor? = nil, gap: CGFloat = 8,
    margin: CGFloat = 8
  ) -> Placement {
    frames(
      toolbar: bar, styleBar: .zero, beside: selection, within: display, keepClear: keepClear,
      holding: held, gap: gap, stack: 0, margin: margin)
  }

  /// The block where the user dragged it: the toolbar at `origin`, kept `margin` inside the
  /// display, and the style bar below it when it fits there, else above it.
  public static func frames(
    toolbar: CGSize, styleBar: CGSize, at origin: CGPoint, within display: CGRect,
    stack: CGFloat = 6, margin: CGFloat = 8
  ) -> (toolbar: CGRect, styleBar: CGRect) {
    let toolbarFrame = CGRect(
      origin: CGPoint(
        x: clamp(origin.x, display.minX + margin, display.maxX - margin - toolbar.width),
        y: clamp(origin.y, display.minY + margin, display.maxY - margin - toolbar.height)),
      size: toolbar)
    let below = toolbarFrame.maxY + stack
    let styleY =
      below + styleBar.height <= display.maxY - margin
      ? below : toolbarFrame.minY - stack - styleBar.height
    let styleX = clamp(
      toolbarFrame.minX, display.minX + margin, display.maxX - margin - styleBar.width)
    return (toolbarFrame, CGRect(origin: CGPoint(x: styleX, y: styleY), size: styleBar))
  }

  /// `value` within `lower...upper`; `lower` wins when the range is empty (a toolbar wider
  /// than the display starts at its left margin).
  private static func clamp(_ value: CGFloat, _ lower: CGFloat, _ upper: CGFloat) -> CGFloat {
    max(lower, min(value, upper))
  }
}
