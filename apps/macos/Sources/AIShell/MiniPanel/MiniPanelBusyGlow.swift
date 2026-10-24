import AICore
import SwiftUI

/// The same field as the command/activity HUD, clipped by the original pill's glass outline, in
/// the attention palette while a task waits for the person (``MiniPanelModel/ongoingWork``).
/// A fixed field stays mounted; its render transform fills the whole changing body, including
/// the hover swell. The parent glass outline clips the field and its rounded caps together.
struct MiniPanelBusyGlow: View {
  let model: MiniPanelModel

  var body: some View {
    let resting = model.phase == .tucked || model.phase == .draggingPill
    let visible = resting && model.ongoingWork != nil
    let side = MiniPanelMetrics.capsuleWidth
    let shape = MiniPanelGlassRect(
      model.body.drawn(model.reduceMotion ? MiniPanelBodyFactors() : model.bodyFactors),
      corner: model.body.corner, in: model.bodyLane)
    let duration =
      model.reduceMotion
      ? IslandGlowStyle.reducedMotionDuration
      : !resting
        ? MiniPanelChoreography.pillFill.exit
        : visible ? IslandGlowStyle.entryDuration : IslandGlowStyle.exitDuration
    IslandPaletteGlow(
      palette: visible ? model.ongoingWork : nil, motionEnabled: !model.reduceMotion
    )
    .frame(width: side, height: side)
    .animation(model.body.animation) {
      $0.modifier(MiniPanelBusyFillEffect(rect: shape.rect))
    }
    .animation(.easeInOut(duration: duration)) { $0.opacity(visible ? 1 : 0) }
    .frame(width: model.bodyLane.width, height: model.bodyLane.height, alignment: .topLeading)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

/// Content's uniform fit would shrink a square field to the pill's narrow width. A background
/// instead fills both axes. This opaque vector takes the same length spring as the glass clip.
private struct MiniPanelBusyFillEffect: GeometryEffect {
  var rect: CGRect

  var animatableData: AnimatablePair<AnimatablePair<Double, Double>, AnimatablePair<Double, Double>>
  {
    get { .init(.init(rect.minX, rect.minY), .init(rect.width, rect.height)) }
    set {
      rect = CGRect(
        x: newValue.first.first, y: newValue.first.second,
        width: newValue.second.first, height: newValue.second.second)
    }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    guard size.width > 0, size.height > 0 else { return ProjectionTransform() }
    return ProjectionTransform(
      CGAffineTransform(
        a: max(rect.width, 0.01) / size.width, b: 0, c: 0,
        d: max(rect.height, 0.01) / size.height, tx: rect.minX, ty: rect.minY))
  }
}
