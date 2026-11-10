import AICore
import SwiftUI

/// One field for the whole command: changing its text from working to writing never remounts it.
/// Its initial frame is ready behind the transparent window, independent of text presence.
struct IslandLoadingGlow: View {
  let model: IslandModel

  var body: some View {
    let shape = model.shape
    let rest = shape.frame
    let kind = model.layers.last?.content.kind
    let loading = kind == .working || kind == .writing
    let fadeDuration =
      model.reduceMotion
      ? IslandGlowStyle.reducedMotionDuration
      : (loading ? IslandGlowStyle.entryDuration : IslandGlowStyle.exitDuration)
    IslandWorkingGlow(active: loading)
      .frame(width: rest.width, height: rest.height)
      .animation(.easeInOut(duration: fadeDuration)) {
        // Keep the fade with the island's morph. The nested AppKit host can resize and
        // reparent as a capsule opens into an answer card without resetting this opacity.
        $0.opacity(loading ? 1 : 0)
      }
      .animation(.easeInOut(duration: IslandGlowStyle.hueDuration)) {
        // A cyan shift marks insertion without interrupting the same flowing field.
        $0.hueRotation(.degrees(kind == .writing || kind == .done ? IslandGlowStyle.writingHue : 0))
      }
      .animation(shape.animation) {
        $0.modifier(IslandGlowFollowEffect(drawn: shape.glass.rect, rest: rest))
      }
      .animation(nil) {
        let shift = IslandMetrics.canvasShift(model.canvas)
        return $0.offset(x: rest.minX + shift.x, y: rest.minY + shift.y)
      }
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// Fill both axes of the glass during a morph without laying out the mesh on every frame.
/// Unlike text, the background must cover the whole shape rather than preserve its aspect ratio,
/// so it moves as the glass does: this opaque vector takes the same length spring as the glass's
/// erased outline and its clip. A ``MiniPanelGlassRect`` would take a spring per axis
/// (``MiniPanelAxisAnimation``), and on a morph the field would part from the glass's edge,
/// leaving a band of bare fill along the edge the card grows from.
private struct IslandGlowFollowEffect: GeometryEffect {
  var drawn: CGRect
  let rest: CGRect

  var animatableData: AnimatablePair<AnimatablePair<Double, Double>, AnimatablePair<Double, Double>>
  {
    get { .init(.init(drawn.minX, drawn.minY), .init(drawn.width, drawn.height)) }
    set {
      drawn = CGRect(
        x: newValue.first.first, y: newValue.first.second,
        width: newValue.second.first, height: newValue.second.second)
    }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    guard rest.width > 0, rest.height > 0 else { return ProjectionTransform() }
    return ProjectionTransform(
      CGAffineTransform(translationX: drawn.minX - rest.minX, y: drawn.minY - rest.minY)
        .scaledBy(x: drawn.width / rest.width, y: drawn.height / rest.height))
  }
}
