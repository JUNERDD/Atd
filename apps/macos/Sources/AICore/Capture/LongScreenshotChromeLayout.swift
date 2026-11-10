import CoreGraphics

/// Where the long screenshot's live chrome sits beside the selection, in the overlay's flipped
/// points (y down), as the prototype places it (`tmp/long-screenshot-prototype/longshot-a.js`,
/// `layout`):
///
/// - The preview strip (``strip(beside:within:)``), ``stripWidth`` wide, ``stripGap`` right of
///   the selection, else as far left of it, else just inside its right edge; as tall as the
///   selection within ``stripMinHeight`` and the display's height less ``stripHeightInset``, its
///   top level with the selection's while it stays inside the display.
/// - The control bar and its status row as one block, placed by the annotation toolbar's rule
///   (``AnnotationToolbarLayout``) and kept clear of the strip as well
///   (``frames(toolbar:styleBar:beside:within:keepClear:strip:gap:stack:margin:)``).
///
/// The selection never moves while the page is captured, so both are placed once and again only
/// when the bar is dragged (``AnnotationToolbarLayout/frames(toolbar:styleBar:at:within:stack:margin:)``,
/// which leaves the strip to the user) or its copy changes size.
public enum LongScreenshotChromeLayout {
  public static let stripWidth: CGFloat = 132
  /// Between the selection and a strip beside it.
  public static let stripGap: CGFloat = 12
  public static let stripMinHeight: CGFloat = 200
  /// How much shorter than the display the strip stays at most.
  public static let stripHeightInset: CGFloat = 32
  /// The strip stays this far inside the display.
  public static let stripMargin: CGFloat = 8

  /// The preview strip beside `selection` on `display` (both in the same points). A display too
  /// small for the rule keeps the minimum height and the top margin, as the toolbar's rule keeps
  /// its left margin.
  public static func strip(beside selection: CGRect, within display: CGRect) -> CGRect {
    let height = clamp(
      selection.height, stripMinHeight, display.height - stripHeightInset
    ).rounded()
    var x = selection.maxX + stripGap
    if x + stripWidth > display.maxX - stripMargin {
      x = selection.minX - stripGap - stripWidth
    }
    if x < display.minX + stripMargin { x = selection.maxX - stripMargin - stripWidth }
    let y = clamp(
      selection.minY, display.minY + stripMargin, display.maxY - stripMargin - height)
    return CGRect(x: x.rounded(), y: y.rounded(), width: stripWidth, height: height)
  }

  /// The control bar (`toolbar`) and the room of its status row (`styleBar`) beside `selection`
  /// as ``AnnotationToolbarLayout/frames(toolbar:styleBar:beside:within:keepClear:holding:gap:stack:margin:)``
  /// places them, with `gap` kept clear around `strip` too. The first of these that clears the
  /// strip wins:
  ///
  /// 1. The toolbar's rule as it is. A strip beside a selection at least ``stripMinHeight`` tall
  ///    spans exactly the selection's rows, so this is the usual answer.
  /// 2. The same rule on the selection's side of the strip only (the display narrowed to it:
  ///    right of a strip left of the selection, else left of the strip), so the block cannot
  ///    slide past the bottom bar into the strip, nor a row wider than the bar reach it, and a
  ///    block inside a selection that fills the display stays off the strip inside its edge.
  /// 3. The rule beside the selection and the strip together, so the block goes under or over
  ///    both (a strip taller than a short selection).
  ///
  /// Steps 2 and 3 count only when the block also stays `margin` inside the display. When none
  /// clears the strip, step 1's frames stand and the block covers part of the strip.
  public static func frames(
    toolbar: CGSize, styleBar: CGSize, beside selection: CGRect, within display: CGRect,
    keepClear: AnnotationToolbarLayout.KeepClear, strip: CGRect, gap: CGFloat = 8,
    stack: CGFloat = 6, margin: CGFloat = 8
  ) -> (toolbar: CGRect, styleBar: CGRect) {
    func place(beside area: CGRect, within room: CGRect) -> (toolbar: CGRect, styleBar: CGRect) {
      let placed = AnnotationToolbarLayout.frames(
        toolbar: toolbar, styleBar: styleBar, beside: area, within: room, keepClear: keepClear,
        gap: gap, stack: stack, margin: margin)
      return (placed.toolbar, placed.styleBar)
    }
    let clearance = strip.insetBy(dx: -gap, dy: -gap)
    // Half a point of slack, for frames the rule rounds to its margins.
    let inside = display.insetBy(dx: margin - 0.5, dy: margin - 0.5)
    func clears(_ frames: (toolbar: CGRect, styleBar: CGRect)) -> Bool {
      !frames.toolbar.intersects(clearance) && !frames.styleBar.intersects(clearance)
    }
    func fits(_ frames: (toolbar: CGRect, styleBar: CGRect)) -> Bool {
      clears(frames) && inside.contains(frames.toolbar) && inside.contains(frames.styleBar)
    }
    let plain = place(beside: selection, within: display)
    guard !strip.isEmpty, !clears(plain) else { return plain }
    // The rule keeps `margin` inside its room, so a room edge `margin` past the clearance keeps
    // the block on its side of it.
    let side =
      strip.maxX <= selection.minX
      ? narrowed(display, minX: strip.maxX + gap - margin)
      : narrowed(display, maxX: strip.minX - gap + margin)
    let candidates = [
      place(beside: selection, within: side),
      place(beside: selection.union(strip), within: display),
    ]
    return candidates.first(where: fits) ?? plain
  }

  /// `display` with its left or right edge moved in; an inverted range leaves it empty.
  private static func narrowed(
    _ display: CGRect, minX: CGFloat? = nil, maxX: CGFloat? = nil
  ) -> CGRect {
    let left = max(display.minX, minX ?? display.minX)
    let right = min(display.maxX, maxX ?? display.maxX)
    return CGRect(x: left, y: display.minY, width: max(0, right - left), height: display.height)
  }

  /// `value` within `lower...upper`; `lower` wins when the range is empty.
  private static func clamp(_ value: CGFloat, _ lower: CGFloat, _ upper: CGFloat) -> CGFloat {
    max(lower, min(value, upper))
  }
}
