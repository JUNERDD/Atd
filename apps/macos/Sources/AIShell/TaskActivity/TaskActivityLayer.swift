import AICore
import AppKit
import SwiftUI

/// Both surfaces stay mounted. Their reveal and their attachment to the body are separate
/// render effects, so opening, collapsing and dragging never write presentation geometry.
struct TaskActivityLayer: View {
  let mini: MiniPanelModel
  let activity: TaskActivityModel

  var body: some View {
    let reduced = activity.reducedMotion
    let body = reduced ? mini.frame(.capsule) : mini.body.drawn(mini.bodyFactors)
    let side = TaskActivityMetrics.entrySide
    let entryOrigin = CGPoint(
      x: body.midX - side / 2,
      y: (activity.below
        ? body.maxY + TaskActivityMetrics.gap
        : body.minY - TaskActivityMetrics.gap - side))
    ZStack(alignment: .topLeading) {
      surface(
        presence: activity.entry, size: CGSize(width: side, height: side),
        anchor: CGPoint(x: side / 2, y: activity.below ? 0 : side), corner: side / 2
      ) {
        TaskActivityEntry(model: activity)
      }
      .frame(width: side, height: side, alignment: .topLeading)
      .scaleEffect(activity.entryPressed && !reduced ? MiniPanelChoreography.bodyPressScale : 1)
      .animation(
        activity.entryPressed
          ? MiniPanelChoreography.bodyPress.animation
          : MiniPanelChoreography.bodyRelease.reduced(reduced).animation,
        value: activity.entryPressed
      )
      .animation(reduced ? nil : mini.body.animation) {
        $0.modifier(TaskActivityTranslation(origin: entryOrigin))
      }
      .offset(x: mini.glassFrame.minX, y: mini.glassFrame.minY)
      .allowsHitTesting(activity.entryInteractive && mini.phase == .expanded)
      .accessibilityHidden(!activity.entryInteractive || mini.phase != .expanded)

      MiniPanelPopover(state: activity.popover, lane: activity.cardLane) { presentation in
        card(presentation)
      }
      .offset(x: mini.glassFrame.minX, y: mini.glassFrame.minY)
      .allowsHitTesting(activity.cardInteractive && mini.phase == .expanded)
      .accessibilityHidden(!activity.cardInteractive || mini.phase != .expanded)
    }
    .animation(nil) { $0.offset(mini.bodyFactors.shift) }
    .frame(width: mini.canvas.width, height: mini.canvas.height, alignment: .topLeading)
    .animation(nil) { $0.opacity(mini.phase == .hidden ? 0 : 1) }
  }

  /// The card in its glass. While the open card resizes, its glass springs to the new frame
  /// (``MiniPanelPopoverState/resizing``): the content is laid out at the new frame at once and
  /// rides with the glass's top leading corner, cut to the glass, rather than being scaled to
  /// follow it as it is while the card opens and closes.
  private func card(_ presentation: MiniPanelPopoverContent) -> some View {
    let popover = activity.popover
    let resizing = popover.resizing
    let follow = MiniPanelPopoverContent(
      shape: presentation.shape, rest: presentation.rest,
      animation: resizing ? nil : presentation.animation, presence: presentation.presence,
      reducedMotion: presentation.reducedMotion)
    let glass = MiniPanelGlassRect(
      resizing ? popover.shape.frame : popover.rest, corner: MiniPanelMetrics.cardRadius,
      in: .zero)
    return TaskActivityCard(model: activity, live: true)
      .animation(resizing ? popover.shape.animation : nil) {
        $0.modifier(TaskActivityGlassTrack(glass: glass, rest: popover.rest))
      }
      .modifier(follow.effect())
  }

  private func surface<Content: View>(
    presence: TaskActivityEntryPresence, size: CGSize, anchor: CGPoint, corner: Double,
    @ViewBuilder content: () -> Content
  ) -> some View {
    let room = TaskActivityMetrics.shadow
    let rest = CGRect(origin: CGPoint(x: room, y: room), size: size)
    let collapsed = CGRect(x: room + anchor.x, y: room + anchor.y, width: 0, height: 0)
    let shape = MiniPanelGlassRect(
      activity.reducedMotion || presence.expanded ? rest : collapsed,
      corner: corner, in: .zero)
    let follow = MiniPanelFollowEffect(shape: shape, rest: rest, scales: !activity.reducedMotion)
    return content()
      .frame(width: size.width, height: size.height, alignment: .topLeading)
      .animation(presence.shapeAnimation) { $0.modifier(follow) }
      .animation(presence.contentAnimation) {
        $0.opacity(presence.contentShown ? 1 : 0)
          .blur(radius: presence.contentShown || activity.reducedMotion ? 0 : presence.hiddenBlur)
      }
      .offset(x: rest.minX, y: rest.minY)
      .frame(width: size.width + room * 2, height: size.height + room * 2, alignment: .topLeading)
      .glassSurface(in: MiniPanelGlassOutline(shape: shape), animation: presence.shapeAnimation)
      .backport.glassEffectContainer(spacing: MiniPanelView.glassSpacing)
      // A modifier inside glassEffect does not necessarily affect the native glass surface.
      // The container's opacity includes the glass itself, including Reduce Motion's fade.
      .animation(presence.opacityAnimation) { $0.opacity(presence.opacity) }
      .offset(x: -room, y: -room)
  }
}

/// Using a pair keeps this on the body's length curve, matching its erased glass contour.
/// Scaling the whole container would leave native glass and its content with different bounds.
private struct TaskActivityTranslation: GeometryEffect {
  var origin: CGPoint

  var animatableData: AnimatablePair<Double, Double> {
    get { AnimatablePair(origin.x, origin.y) }
    set { origin = CGPoint(x: newValue.first, y: newValue.second) }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    ProjectionTransform(CGAffineTransform(translationX: origin.x, y: origin.y))
  }
}

/// Keeps the card's content on its glass while the glass springs to a new size: laid out at the
/// new frame, it sits at the glass's top leading corner and shows only inside the glass.
private struct TaskActivityGlassTrack: ViewModifier, Animatable {
  /// The glass's frame, in the same coordinates as `rest`.
  var glass: MiniPanelGlassRect
  let rest: CGRect

  var animatableData: MiniPanelGlassRect {
    get { glass }
    set { glass = newValue }
  }

  func body(content: Content) -> some View {
    content
      .mask(alignment: .topLeading) {
        RoundedRectangle(cornerRadius: glass.corner, style: .continuous)
          .frame(width: max(glass.width, 0), height: max(glass.height, 0))
      }
      .offset(x: glass.x - rest.minX, y: glass.y - rest.minY)
  }
}
