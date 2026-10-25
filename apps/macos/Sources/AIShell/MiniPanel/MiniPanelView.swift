import AICore
import AppKit
import SwiftUI

/// The mini panel as drawn (spec v1 Material, surface-v2, motion-v3, perf-v1): each surface has its
/// own `GlassEffectContainer`, so the body's collapse cannot revive a departed label's glass as
/// a horizontal streak. Tooltips and the card fade outside their containers, where opacity also
/// affects glass. A label-to-card handoff transfers the opaque surface. All pieces take the app's
/// scheme whatever the window behind it: its glass carries the panel's base fill and its content
/// keeps the app's scheme (``View/glassSurface(in:animation:)``), so a piece looks the
/// same from its first frame rather than turning with the backdrop as the glass adapts. The
/// containers cover only where glass can be (``MiniPanelLayout/glassRegion``), never the whole
/// transparent canvas.
///
/// Nothing here is written while it moves: every value carries its own animation and the views
/// apply them as scoped animations, so SwiftUI interpolates them and each axis, factor and look
/// keeps its own curve whichever change redraws it. Each piece is drawn in a fixed lane, and its
/// glass, its clip and the content riding inside it all take one animated value, so each frame of
/// an animation updates only render effects, never a layout or a view body; the clip moves as the
/// glass does (``View/clippedGlass(in:)``), so the base fill and the content never
/// show outside the glass. Buttons and rows sit plain on the glass with neutral washes,
/// never glass on glass; a state shows through shape and content alone.
///
/// No piece carries a `glassEffectID`: none is ever inserted or removed, so no glass transition
/// has anything to match. macOS 15 has no container (``Backport``): each piece stands on its
/// own material (``View/clippedGlass(in:)``).
struct MiniPanelView: View {
  let model: MiniPanelModel

  /// Each container holds one glass surface; kept below the 8 pt gaps between surfaces.
  static let glassSpacing = 6.0

  var body: some View {
    let region = model.glassFrame
    ZStack(alignment: .topLeading) {
      if let zone = model.dropZone {
        // Invisible, but drawn: the window server gives a drag's release to drawn pixels only,
        // so a drop anywhere in the magnet's reach lands on the panel (as DesktopDropCatcher's).
        // The body's own shape is cut out of it, so nothing lies under the glass.
        MiniPanelZoneShape(zone: zone)
          .fill(Color.black.opacity(1.0 / 255), style: FillStyle(eoFill: true))
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      if model.phase == .tucked, let zone = model.clickZone {
        // Invisible, but drawn, as the drop zone is: opening on click, the window server gives
        // the panel a click anywhere the pill swells for, the screen edge included.
        Rectangle()
          .fill(Color.black.opacity(1.0 / 255))
          .frame(width: zone.width, height: zone.height)
          .offset(x: zone.minX, y: zone.minY)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      if model.phase != .hidden {
        MiniPanelBody(model: model)
      }
    }
    .frame(width: region.width, height: region.height, alignment: .topLeading)
    .backport.glassEffectContainer(spacing: Self.glassSpacing)
    .overlay(alignment: .topLeading) {
      ZStack(alignment: .topLeading) {
        MiniPanelCard(model: model)
        MiniPanelLabelView(model: model)
      }
      .frame(width: region.width, height: region.height, alignment: .topLeading)
    }
    .offset(x: region.minX, y: region.minY)
    .frame(width: model.canvas.width, height: model.canvas.height, alignment: .topLeading)
    .overlay(alignment: .topLeading) {
      if let activity = model.activity {
        TaskActivityLayer(mini: model, activity: activity)
      }
    }
    // The glass draws its first frame in the app's scheme, and follows it when it changes.
    .environment(\.colorScheme, GlassSurface.colorScheme)
    .transaction(value: model.coordinateRevision) { $0.disablesAnimations = true }
  }
}

/// The body glass: one living shape in its fixed lane (``MiniPanelModel/bodyLane``), its
/// thickness and length on their own springs (``MiniPanelAxisAnimation``). Each content is laid
/// out where its shape rests and follows the shape as drawn (``MiniPanelFollowEffect``), centered
/// in it and scaled with it, inside the clip, before the glass, which the container draws from
/// the same shape.
///
/// The press's squish and the drag's lift scale glass and content alike; the release's stretch
/// and the drop's squash deform the glass alone, the content following the shape without them.
/// All of them are drawn into the shape, about its middle (``MiniPanelBodyShape/drawn(_:)``),
/// never as transforms: in the glass container a glass view's scale is dropped and only its
/// translation kept (macOS 26), so a scaled body would slide aside rather than squish. Each
/// change moves on its own animation, which the shape carries, and only shapes and render effects
/// change from frame to frame, so nothing lays out again (perf-v1).
private struct MiniPanelBody: View {
  let model: MiniPanelModel

  var body: some View {
    let lane = model.bodyLane
    let shape = model.body
    let local = shape.frame.offsetBy(dx: -lane.minX, dy: -lane.minY)
    let factors = model.bodyFactors
    let outline = MiniPanelGlassOutline(
      shape: MiniPanelGlassRect(
        shape.drawn(model.reduceMotion ? MiniPanelBodyFactors() : factors), corner: shape.corner,
        in: lane))
    MiniPanelBodyContent(model: model)
      .frame(width: lane.width, height: lane.height, alignment: .topLeading)
      .overlay(alignment: .topLeading) {
        if model.phase == .tucked {
          MiniPanelPill(model: model)
            .frame(width: local.width, height: local.height)
            .offset(x: local.minX, y: local.minY)
        }
      }
      .glassSurface(in: outline, animation: shape.animation)
      .offset(x: lane.minX, y: lane.minY)
      .animation(nil) { $0.offset(factors.shift) }
  }
}

/// Every content of every body shape, mounted for good, each laid out where its shape rests (in
/// the lane) and following the body as drawn, arriving and leaving on its own presence.
private struct MiniPanelBodyContent: View {
  let model: MiniPanelModel

  var body: some View {
    ZStack(alignment: .topLeading) {
      MiniPanelPillFill(model: model)
        .frame(width: model.bodyLane.width, height: model.bodyLane.height)
      MiniPanelBusyGlow(model: model)
      layer(.capsule) { MiniPanelCapsule(model: model) }
      layer(.invite) { MiniPanelInvite(model: model) }
      layer(.card) { MiniPanelDropCard(model: model) }
    }
  }

  private func layer<Content: View>(
    _ content: MiniPanelContent, @ViewBuilder _ view: () -> Content
  ) -> some View {
    let lane = model.bodyLane
    let shape = model.body
    let frame = model.frame(content).offsetBy(dx: -lane.minX, dy: -lane.minY)
    // The content takes the squish and the lift with the glass, but not its deformation.
    let factors = MiniPanelBodyFactors(scale: model.reduceMotion ? 1 : model.bodyFactors.scale)
    let follow = MiniPanelFollowEffect(
      shape: MiniPanelGlassRect(shape.drawn(factors), corner: shape.corner, in: lane),
      rest: frame, scales: !model.reduceMotion)
    let active = model.activeContent == content
    return view()
      .frame(width: frame.width, height: frame.height)
      .animation(shape.animation) { $0.modifier(follow) }
      .modifier(MiniPanelPresenceEffect(presence: model.presence(content)))
      .animation(nil) { $0.offset(x: frame.minX, y: frame.minY) }
      .allowsHitTesting(active)
      .accessibilityHidden(!active)
  }
}

/// The resting pill's tone (pill-v2): over a window of its own scheme the base fill of glass this
/// thin all but matches what lies behind it, and the pill disappears, so the pill and its swell
/// are filled with a neutral tone, the scheme's label color, that the body's outline clips,
/// following every frame of its glass. It leaves as the pill opens, as the capsule's controls would, and
/// returns once the body has all but drawn back into the pill, so every other shape shows its
/// glass and base fill alone.
private struct MiniPanelPillFill: View {
  let model: MiniPanelModel
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    let resting = model.phase == .tucked || model.phase == .draggingPill
    let level = contrast == .increased ? 0.4 : MiniPanelChoreography.pillFillLevel
    Rectangle()
      .fill(Color.primary.opacity(level))
      .modifier(
        MiniPanelPresenceEffect(
          presence: MiniPanelPresence(shown: resting, motion: MiniPanelChoreography.pillFill))
      )
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// Content arriving or leaving (motion-v3): its opacity and its blur together, after the
/// arrival's delay; its size follows its shape. The blur is applied to the content alone, never
/// to the glass, and is gone at rest.
struct MiniPanelPresenceEffect: ViewModifier {
  let presence: MiniPanelPresence

  func body(content: Content) -> some View {
    let (shown, motion) = (presence.shown, presence.motion)
    let arrive = MiniPanelChoreography.contentOpacity.animation.delay(motion.delay)
    let leave = Animation.easeIn(duration: motion.exit)
    content
      .animation(shown ? arrive : leave) {
        $0.blur(radius: shown ? 0 : motion.hiddenBlur).opacity(shown ? 1 : 0)
      }
  }
}

/// The resting pill: one element for VoiceOver, a button named for the panel that opens it,
/// with the capsule's actions as its own so they need no expansion. It is sized to the body. A
/// click on it opens the panel through the window, which takes it rather than SwiftUI
/// (``MiniPanelController``'s `click(_:)`).
private struct MiniPanelPill: View {
  let model: MiniPanelModel

  var body: some View {
    Color.clear
      .accessibilityElement()
      .accessibilityLabel(Text(verbatim: model.labels.panel))
      .accessibilityAddTraits(.isButton)
      .accessibilityAction { model.expand() }
      .accessibilityAction(named: Text(verbatim: model.markLabel)) { model.perform(.mark) }
      .accessibilityAction(named: Text(verbatim: model.labels.newTask)) {
        model.perform(.newTask)
      }
      .accessibilityAction(named: Text(verbatim: model.labels.ask)) { model.perform(.ask) }
      .accessibilityAction(named: Text(verbatim: model.labels.screenshot)) {
        model.perform(.screenshot)
      }
      .accessibilityIdentifier("miniPanel.pill")
  }
}
