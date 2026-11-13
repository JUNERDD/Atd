import AICore
import AppKit
import SwiftUI

/// All island contents use the common surface. Business views supply their target layout;
/// the surface owns the layout policy and the animation given to each layer.
struct IslandView: View {
  let model: IslandModel

  var body: some View {
    let shape = model.shape
    let card = model.layers.last(where: { $0.shellCard != nil })?.shellCard ?? model.keptShellCard
    let change: IslandShellGeometry =
      if let layout = card?.layout, let origin = card?.layoutOrigin {
        IslandShellGeometry(layout: layout) - IslandShellGeometry(layout: origin)
      } else { .zero }
    let frame = AnimatablePair(shape.glass, change)
    let content = ZStack(alignment: .topLeading) {
      IslandLoadingGlowHost(model: model)
      ForEach(model.layers) { layer in
        IslandLayerView(
          model: model, layer: layer, canvas: model.canvas, reduceMotion: model.reduceMotion
        ).equatable()
      }
    }
    IslandSurface(
      frame: frame, canvas: model.canvas, animation: shape.animation,
      layoutMotion: model.layoutMotion, content: content
    )
    .transaction(value: model.appearance) { $0.disablesAnimations = true }
  }
}

/// Places each business view at its measured size. Reflow placement follows the interpolated
/// layout, so native hit regions move with the pixels; fixed content retains its measured rest.
private struct IslandLayerView: View, Equatable {
  let model: IslandModel
  let layer: IslandLayer
  let canvas: WindowSize
  let reduceMotion: Bool
  @Environment(\.[island: IslandPresentationKey<IslandShellGeometry>()])
  private var presentation
  @Environment(\.islandContentAnimation) private var animation

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.model === rhs.model && lhs.layer == rhs.layer && lhs.canvas == rhs.canvas
      && lhs.reduceMotion == rhs.reduceMotion
  }

  var body: some View {
    let origin = layer.shellCard?.layoutOrigin
    let geometry = origin.map { IslandShellGeometry(layout: $0) + presentation.second }
    // Keep the first measurement only as the interpolation baseline. Holding its position
    // while moving a larger card with ignoredByLayout leaves native hit regions behind.
    // This placement uses the current presentation, never the destination, so it cannot snap.
    // A reflowing layer lays out at its shape as drawn, so it follows with no transform.
    let rest =
      geometry.map { IslandMetrics.rest($0.size) }
      ?? (layer.reflows ? presentation.first.rect : layer.rest)
    let active = layer.presence.shown
    let shift = IslandMetrics.canvasShift(canvas)
    IslandLayerContent(model: model, layer: layer, geometry: geometry, rest: rest)
      // Presentation frames must not rebuild unchanged command text or recording controls.
      // Their own observable state still invalidates the views that read it.
      .equatable()
      .geometryGroup()
      .environment(\.floatingHoverActive, active)
      .frame(width: rest.width, height: rest.height)
      .animation(animation) {
        $0.modifier(
          MiniPanelFollowEffect(
            shape: presentation.first, rest: rest, scales: !reduceMotion && layer.scales
          ).ignoredByLayout())
      }
      .animation(nil) { $0.offset(x: rest.minX + shift.x, y: rest.minY + shift.y) }
      .modifier(MiniPanelPresenceEffect(presence: layer.presence))
      .allowsHitTesting(active)
      .accessibilityHidden(!active)
  }
}

/// Business composition has no presentation-frame input. Equality holds fixed-layout content
/// outside the animation's per-frame work; actual recording reflow supplies a changed geometry.
private struct IslandLayerContent: View, Equatable {
  let model: IslandModel
  let layer: IslandLayer
  let geometry: IslandShellGeometry?
  /// Where the content lays out: its rest, or its shape as drawn while it reflows.
  let rest: CGRect

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.model === rhs.model && lhs.layer == rhs.layer && lhs.geometry == rhs.geometry
      && lhs.rest == rhs.rest
  }

  @ViewBuilder var body: some View {
    let active = layer.presence.shown
    if case .recording(let card)? = layer.shellCard, let geometry {
      IslandRecordingCard(model: model, card: card, active: active, geometry: geometry)
    } else if case .longScreenshot(let card)? = layer.shellCard, let geometry {
      IslandLongScreenshotCard(model: model, card: card, active: active, geometry: geometry)
    } else if case .choose(let command) = layer.content, let card = layer.card ?? model.card {
      IslandCard(
        model: model, command: command, card: card, active: active && layer.card == nil,
        width: rest.width)
    } else if case .answer(let command, let answer, let note) = layer.content {
      IslandAnswerCard(
        model: model, command: command, answer: answer, note: note, offer: layer.answerOffer,
        width: rest.width,
        height: rest.height)
    } else if case .review(let command, let answer, let note, let review) = layer.content {
      IslandReviewCard(
        model: model, command: command, answer: answer, note: note, review: review,
        offer: layer.answerOffer, active: active, width: rest.width, height: rest.height)
    } else if case .compose(let command, let attach) = layer.content {
      IslandComposeCard(
        model: model, command: command, attach: attach, active: active, width: rest.width,
        height: rest.height)
    } else {
      IslandCapsule(model: model, content: layer.content, limits: layer.limits)
    }
  }
}
