import AICore
import CoreGraphics

extension IslandShape {
  /// The pill the island enters from (``IslandChoreography/entranceWidth`` and
  /// ``IslandChoreography/entranceHeight``): this shape at those shares of its width and height,
  /// standing on the middle of its bottom edge, its corner scaled with its height so a capsule
  /// stays a capsule. Drawn into the shape, as ``scaled(_:drop:animation:)`` is, so the entrance's
  /// springs run on each axis of the glass (``MiniPanelShapeAxis/vertical``).
  var entrancePill: IslandShape {
    let share = (width: IslandChoreography.entranceWidth, height: IslandChoreography.entranceHeight)
    let width = frame.width * share.width
    let height = frame.height * share.height
    return IslandShape(
      frame: CGRect(
        x: frame.midX - width / 2, y: frame.maxY - height, width: width, height: height),
      corner: corner * share.height)
  }
}
