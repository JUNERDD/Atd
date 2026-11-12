import CoreGraphics

/// The drawing room for island shapes: commands fit the default canvas; recording reserves
/// its work area before entering so answers growing never resize the native window during a
/// morph. The canvas returns to its default only after the island leaves.
///
/// Shapes and contents keep their coordinates in the default canvas (``IslandMetrics/rest(_:)``)
/// whatever size the window has: a larger canvas only draws them ``canvasShift(_:)`` further
/// right and down, and its window reaches as far beyond them (``windowOrigin(_:anchor:)``), so
/// its edges move away from the shapes without moving them on screen, even in the middle of a
/// morph.
extension IslandMetrics {
  /// The canvas a shape of `size` needs: the default one, or larger in either direction, with
  /// the shape's overshoot (``MiniPanelChoreography/followLimit``) and ``inset`` around it.
  public static func canvas(fitting size: WindowSize) -> WindowSize {
    let limit = MiniPanelChoreography.followLimit
    let base = canvas
    return WindowSize(
      width: max(base.width, (size.width * limit + inset * 2).rounded(.up)),
      height: max(base.height, (size.height * limit + inset * 2).rounded(.up)))
  }

  /// The larger of two canvases in each direction.
  public static func canvas(_ one: WindowSize, _ other: WindowSize) -> WindowSize {
    WindowSize(width: max(one.width, other.width), height: max(one.height, other.height))
  }

  /// How far a canvas of `size` draws the default canvas's coordinates (y down): centred across
  /// it to the whole point, and standing on its bottom edge, so a shape on whole points stays on
  /// them in any canvas.
  public static func canvasShift(_ size: WindowSize) -> (x: Double, y: Double) {
    let base = canvas
    return (((size.width - base.width) / 2).rounded(.down), size.height - base.height)
  }

  /// The origin (y up) of the window that holds a canvas of `size` for shapes whose bottom centre
  /// rests at `anchor`: the default canvas's middle over the anchor and its shapes' bottom edge on
  /// it, ``inset`` above the window's bottom; a larger canvas reaches ``canvasShift(_:)`` further
  /// left and keeps its extra height above. On whole points for a whole-point anchor, since the
  /// default canvas is an even number of points across.
  public static func windowOrigin(_ size: WindowSize, anchor: CGPoint) -> CGPoint {
    CGPoint(x: anchor.x - canvas.width / 2 - canvasShift(size).x, y: anchor.y - inset)
  }
}
