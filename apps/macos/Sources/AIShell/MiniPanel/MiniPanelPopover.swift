import AICore
import SwiftUI

/// The original Command glass container. Both popup contents receive the same presentation
/// context; scroll content may apply it inside its viewport to preserve AppKit's scroll offset.
struct MiniPanelPopover<Content: View>: View {
  let state: MiniPanelPopoverState
  let lane: CGRect
  @ViewBuilder let content: (MiniPanelPopoverContent) -> Content

  var body: some View {
    let rest = state.rest.offsetBy(dx: -lane.minX, dy: -lane.minY)
    let shape = MiniPanelGlassRect(
      state.reducedMotion ? state.rest : state.shape.frame, corner: MiniPanelMetrics.cardRadius,
      in: lane)
    let presentation = MiniPanelPopoverContent(
      shape: shape, rest: rest, animation: state.shape.animation,
      presence: state.presence, reducedMotion: state.reducedMotion)
    content(presentation)
      .frame(width: rest.width, height: rest.height)
      .animation(nil) { $0.offset(x: rest.minX, y: rest.minY) }
      .frame(width: lane.width, height: lane.height, alignment: .topLeading)
      .glassSurface(in: MiniPanelGlassOutline(shape: shape), animation: state.shape.animation)
      .backport.glassEffectContainer(spacing: MiniPanelView.glassSpacing)
      .animation(
        state.shape.isLabelHandoff && state.isOpen
          ? nil : MiniPanelMotion.popoverOpacity(state.isOpen)
      ) { $0.opacity(state.opacity) }
      .offset(x: lane.minX, y: lane.minY)
      .allowsHitTesting(state.interactive)
      .accessibilityHidden(!state.interactive)
  }
}

struct MiniPanelPopoverContent {
  let shape: MiniPanelGlassRect
  let rest: CGRect
  let animation: Animation?
  let presence: MiniPanelPresence
  let reducedMotion: Bool

  func effect(middleY: Double? = nil) -> some ViewModifier {
    MiniPanelPopoverContentEffect(presentation: self, middleY: middleY)
  }
}

private struct MiniPanelPopoverContentEffect: ViewModifier {
  let presentation: MiniPanelPopoverContent
  let middleY: Double?

  func body(content: Content) -> some View {
    let presence = MiniPanelPresence(
      shown: presentation.presence.shown,
      motion: presentation.reducedMotion
        ? MiniPanelContentMotion(delay: 0, exit: MiniPanelChoreography.rows.exit, hiddenBlur: 0)
        : presentation.presence.motion)
    // Keep the same content identity when the setting changes, including its scroll position.
    content
      .animation(presentation.reducedMotion ? nil : presentation.animation) {
        $0.modifier(
          MiniPanelFollowEffect(
            shape: presentation.shape, rest: presentation.rest,
            scales: !presentation.reducedMotion, middleY: middleY))
      }
      .modifier(MiniPanelPresenceEffect(presence: presence))
  }
}
