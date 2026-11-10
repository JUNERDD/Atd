/// The drawing room for island shapes: commands fit the default canvas; recording reserves
/// its work area before entering so answers growing never resize the native window during a
/// morph. The canvas returns to its default only after the island leaves.
///
/// Shapes and contents keep their coordinates in the default canvas (``IslandMetrics/rest(_:)``)
/// whatever size the window has: a larger canvas only draws them ``canvasShift(_:)`` further
/// right and down, so its edges move away from the shapes without moving them on screen, even
/// in the middle of a morph.
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
  /// it, and standing on its bottom edge.
  public static func canvasShift(_ size: WindowSize) -> (x: Double, y: Double) {
    let base = canvas
    return ((size.width - base.width) / 2, size.height - base.height)
  }
}
