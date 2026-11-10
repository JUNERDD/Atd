import CoreGraphics

/// Where a capture session's bottom bar sits on a display (architecture C2, C3), in the overlay's
/// flipped desktop points (y down). It is centred ``edgeGap`` above the bottom of the display's
/// safe area, and moves the same distance below the top of it only when the selection, inflated
/// by ``clearance``, lies on the bottom spot and not on the top one; when both are covered it
/// stays at the bottom. The rule reads the selection and the bar's current content size, never
/// the bars beside the selection; those bars keep clear of it instead
/// (``AnnotationToolbarLayout/KeepClear``).
public enum CaptureBarLayout {
  /// From the safe area's bottom (or top) edge to the bar.
  public static let edgeGap: CGFloat = 28
  /// How far the selection must stay from a spot for the bar to take it.
  public static let clearance: CGFloat = 8
  /// Between the bar and the Accessibility request capsule.
  public static let stack: CGFloat = 8

  /// The bar's frame for a bar of `size` on `display` (its frame in desktop points), whose safe
  /// area is inset by `safeTop` and `safeBottom`; `selection` is the committed selection, nil
  /// while none is.
  public static func frame(
    size: CGSize, display: CGRect, safeTop: CGFloat = 0, safeBottom: CGFloat = 0,
    selection: CGRect?
  ) -> CGRect {
    let x = (display.midX - size.width / 2).rounded()
    let bottom = CGRect(
      origin: CGPoint(x: x, y: display.maxY - safeBottom - edgeGap - size.height), size: size)
    let top = CGRect(origin: CGPoint(x: x, y: display.minY + safeTop + edgeGap), size: size)
    guard let selection else { return bottom }
    func covered(_ spot: CGRect) -> Bool {
      selection.intersects(spot.insetBy(dx: -clearance, dy: -clearance))
    }
    return covered(bottom) && !covered(top) ? top : bottom
  }

  /// The Accessibility request capsule of `size`, centred on `display`: ``stack`` above `bar`, or
  /// below it when the bar sits in the display's top half.
  public static func requestFrame(size: CGSize, bar: CGRect, display: CGRect) -> CGRect {
    let x = (display.midX - size.width / 2).rounded()
    let y = bar.midY < display.midY ? bar.maxY + stack : bar.minY - stack - size.height
    return CGRect(origin: CGPoint(x: x, y: y), size: size)
  }
}

/// Where the selection's "W × H" size label sits (`CaptureChromeView`): above the top-left corner
/// of the part of the area on the display, 6 pt off it, or just inside it when the display's top
/// edge is in the way; always 4 pt within the display. The bars beside the selection read the
/// same frame to keep clear of the label (``AnnotationToolbarLayout/KeepClear``).
public enum CaptureSizeLabelLayout {
  public static func frame(area: CGRect, size: CGSize, display: CGRect) -> CGRect {
    let part = area.intersection(display)
    let visible = part.isNull ? area : part
    let above = visible.minY - size.height - 6
    let y = above >= display.minY + 4 ? above : visible.minY + 6
    let x = min(max(visible.minX, display.minX + 4), display.maxX - size.width - 4)
    return CGRect(origin: CGPoint(x: x, y: y), size: size).integral
  }
}
