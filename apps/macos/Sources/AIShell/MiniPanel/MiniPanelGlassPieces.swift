import AICore
import AppKit
import SwiftUI

/// The commands card's glass: closed, it has shrunk to nothing at its anchor beside the capsule;
/// it grows out of there to the card's frame on its own animation, its fill with it, so no bare
/// glass shows on the way in or out, and its rows, laid out where
/// the open card rests, ride inside it, centered in it and scaled with it (``MiniPanelFlyout``),
/// so they open out of the anchor with the card. It is drawn in a fixed lane that holds the card
/// and every body shape it closes into, so its frames lay nothing out again while it opens or
/// closes (perf-v1).
struct MiniPanelCard: View {
  let model: MiniPanelModel

  var body: some View {
    MiniPanelPopover(state: model.popover, lane: model.cardLane) { presentation in
      MiniPanelFlyout(model: model, presentation: presentation)
    }
  }
}

/// The hover label (hover-label-v4): a small capsule of the same glass that grows out of an anchor
/// on its side facing the capsule, level with the hovered control, glides from control to
/// control, and leaves into that anchor, its fill with its glass, so it never shows as bare glass
/// (``MiniPanelLabelPath``). Its text rides
/// inside it on the same animated values (``MiniPanelLabelFollowEffect``): it grows with the
/// label, glides with it, cross-fades between names, and shows only through its own presence.
/// Visual only: VoiceOver reads the controls' own labels.
///
/// It is drawn in a fixed lane beside the shape it belongs to, so its frames lay nothing out
/// again (perf-v1): only its outline (a shape) and its text's transform move.
struct MiniPanelLabelView: View {
  let model: MiniPanelModel

  var body: some View {
    let label = model.label
    let lane = label.lane
    // A glide swaps its text on its own animation; a hidden label swaps it at once.
    let swap = MiniPanelChoreography.labelGlide.reduced(model.reduceMotion).animation
    let rest = label.rest.offsetBy(dx: -lane.minX, dy: -lane.minY)
    let outline = MiniPanelLabelOutline(fade: label.fade, rest: rest, edge: model.edge)
    let bubble = MiniPanelLabelOutline(
      fade: label.bubbleTaken ? 1 : label.fade, rest: rest, edge: model.edge)
    let presented = label.drawn && label.fade == 0
    let follow = MiniPanelLabelFollowEffect(
      fade: label.fade, rest: rest, edge: model.edge, scales: !model.reduceMotion)
    Color.clear
      .frame(width: lane.width, height: lane.height)
      .glassSurface(in: bubble, animation: label.bubbleTaken ? nil : label.animation)
      .backport.glassEffectContainer(spacing: MiniPanelView.glassSpacing)
      .overlay(alignment: .topLeading) {
        ZStack {
          // Preserve each name's own layout during the cross-fade. Text.contentTransition
          // reuses the new width for the old glyphs, shifting/clipping a long name on a short one.
          Text(verbatim: label.text)
            .font(.system(size: MiniPanelMetrics.labelTextSize, weight: .medium))
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(.primary)
            .padding(.horizontal, MiniPanelMetrics.labelPadding)
            .frame(width: rest.width, height: rest.height)
            .id(label.text)
            .transition(.opacity)
        }
        .animation(label.drawn ? swap : nil, value: label.text)
        // A fixed layout center is essential: changing this frame to the new text width would
        // move the outgoing text's origin before its geometry animation has caught up.
        .frame(width: lane.width, height: lane.height)
        .animation(label.animation) { $0.modifier(follow) }
        .modifier(MiniPanelPresenceEffect(presence: model.presence(.labelText)))
        .animation(label.animation) { $0.clipShape(AnyShape(outline)) }
      }
      // Scope the fade to opacity: an inherited animation also retimes the glass container,
      // separating its material outline from the surface fill during entrance.
      .animation(MiniPanelMotion.popoverOpacity(presented)) { $0.opacity(presented ? 1 : 0) }
      .offset(x: lane.minX, y: lane.minY)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// The label's outline at its animated fade, in its lane: SwiftUI interpolates the fade and the
/// rest, and only this shape's path is drawn again on each frame.
/// Its text's transform (``MiniPanelLabelFollowEffect``) takes the same values.
struct MiniPanelLabelOutline: Shape {
  typealias AnimatableData = AnimatablePair<
    AnimatablePair<Double, Double>, AnimatablePair<Double, Double>
  >

  var fade: Double
  var rest: CGRect
  let edge: MiniPanelEdge

  var animatableData: AnimatableData {
    get { Self.data(fade: fade, rest: rest) }
    set { (fade, rest) = Self.values(newValue, height: rest.height) }
  }

  /// The fade and the rest (its height is fixed) as one vector.
  static func data(fade: Double, rest: CGRect) -> AnimatableData {
    AnimatablePair(AnimatablePair(fade, rest.minX), AnimatablePair(rest.minY, rest.width))
  }

  /// The values ``data(fade:rest:)`` holds, with the rest `height` tall.
  static func values(_ data: AnimatableData, height: Double) -> (Double, CGRect) {
    let rest = CGRect(
      x: data.first.second, y: data.second.first, width: data.second.second, height: height)
    return (data.first.first, rest)
  }

  func path(in rect: CGRect) -> Path {
    let shape = MiniPanelLabelPath.rect(fade: fade, rest: rest, edge: edge)
    guard shape.width > 0, shape.height > 0 else { return Path() }
    return Path(roundedRect: shape, cornerRadius: min(shape.width, shape.height) / 2)
  }
}

/// A drag session's drop zone with the body's resting shape cut out (even-odd fill).
struct MiniPanelZoneShape: Shape {
  let zone: MiniPanelDropZone

  func path(in rect: CGRect) -> Path {
    var path = Path(zone.zone)
    let radius = min(zone.corner, min(zone.hole.width, zone.hole.height) / 2)
    path.addRoundedRect(
      in: zone.hole, cornerSize: CGSize(width: radius, height: radius), style: .continuous)
    return path
  }
}
