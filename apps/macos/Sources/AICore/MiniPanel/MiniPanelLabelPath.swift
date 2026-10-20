import CoreGraphics

/// The hover label's way in and out (hover-label-v4): as a popover does, it grows out of an
/// anchor on its own side facing the capsule (or the commands card, for a row's label), level with
/// its control, and leaves into that anchor. No part of it ever lies over the capsule, whose glass
/// and base fill it would darken where the two overlap, and it never stretches across the gap.
///
/// `fade` is how far it is out of sight: 0 at rest, 1 gone. Its glass cannot fade in the glass
/// container (an opacity or a transform on the glass itself is dropped), so its size carries the
/// way out (``scale(fade:)``), its fill with it, so it never shows as bare glass: it draws a
/// little toward its anchor while its text fades, by ``leaveShrink`` at most, and from
/// ``leaveCollapse`` on, its text gone, it draws in to nothing at the anchor. The way in runs the
/// same values backward; a fade below 0 (an elastic entrance) grows it a little past its rest,
/// away from the capsule.
public enum MiniPanelLabelPath {
  /// How much smaller the label has drawn toward its anchor as its text fades: a hint of where
  /// it goes, not a way back.
  public static let leaveShrink = 0.12
  /// How far out of sight the label starts to draw in to nothing, its text gone by then.
  public static let leaveCollapse = 0.6

  /// The label's size `fade` of its way out of sight, as a factor of its size at rest: drawing
  /// toward its anchor by ``leaveShrink``, then, from ``leaveCollapse``, in to nothing
  /// (smoothstep). Below 0 it grows past its rest by the same slope.
  public static func scale(fade: Double) -> Double {
    let f = min(fade, 1)
    let t = min(max((f - leaveCollapse) / (1 - leaveCollapse), 0), 1)
    return (1 - leaveShrink * f) * (1 - t * t * (3 - 2 * t))
  }

  /// Where a label resting at `rest` beside a shape on `edge` of the work area grows out of and
  /// leaves into: the middle of its side facing that shape (the label is on the shape's interior
  /// side). Works in any coordinates whose x grows toward the right.
  public static func anchor(of rest: CGRect, edge: MiniPanelEdge) -> CGPoint {
    CGPoint(x: edge == .right ? rest.maxX : rest.minX, y: rest.midY)
  }

  /// The label `fade` of its way out of sight, resting at `rest` beside a shape on `edge`: the
  /// rest scaled by ``scale(fade:)`` about its ``anchor(of:edge:)``.
  public static func rect(fade: Double, rest: CGRect, edge: MiniPanelEdge) -> CGRect {
    let anchor = anchor(of: rest, edge: edge)
    let scale = max(scale(fade: fade), 0)
    let width = rest.width * scale
    let height = rest.height * scale
    let minX = edge == .right ? anchor.x - width : anchor.x
    return CGRect(x: minX, y: anchor.y - height / 2, width: width, height: height)
  }
}
