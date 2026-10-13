import AICore
import AppKit
import SwiftUI

/// The command island as drawn: one glass shape on the shell's glass surface, as the mini panel's
/// body is (``View/glassSurface(in:animation:opacity:)``: the panel's dark base fill on regular
/// Liquid Glass, the content kept in the dark scheme), with its contents riding inside it. The
/// glass, its clip and every content take the same animated shape value (``IslandShape``), the
/// clip erased as the glass's shape is so the two move as one, so the content can
/// never show outside the glass; each content is laid out where its shape rests and follows the shape as
/// drawn (``MiniPanelFollowEffect``), centred in it and scaling with it up to
/// ``MiniPanelChoreography/followLimit``, and arrives and leaves through opacity and blur
/// (``MiniPanelPresenceEffect``). Only shapes and render effects change from frame to frame.
///
/// The whole canvas is the shape's lane: it holds every shape the island takes, so a morph lays
/// nothing out again. Its transparent pixels pass clicks to the windows below.
struct IslandView: View {
  let model: IslandModel

  var body: some View {
    let canvas = IslandMetrics.canvas
    let shape = model.shape
    let outline = MiniPanelGlassOutline(shape: shape.glass)
    ZStack(alignment: .topLeading) {
      ForEach(model.layers) { layer in
        IslandLayerView(model: model, layer: layer)
      }
    }
    .frame(width: canvas.width, height: canvas.height, alignment: .topLeading)
    .glassSurface(in: outline, animation: shape.animation)
    // The island times its own entrance; the glass adds no transition of its own.
    .backport.glassEffectTransition(.identity)
    .backport.glassEffectContainer()
    .id(model.appearance)
    .frame(width: canvas.width, height: canvas.height, alignment: .topLeading)
    // The glass draws its first frame in this scheme, whatever the system appearance.
    .environment(\.colorScheme, GlassSurface.colorScheme)
  }
}

/// One content, laid out at its rest and following the shape as drawn.
private struct IslandLayerView: View {
  let model: IslandModel
  let layer: IslandLayer

  var body: some View {
    let rest = layer.rest
    let shape = model.shape
    let follow = MiniPanelFollowEffect(
      shape: shape.glass, rest: rest, scales: !model.reduceMotion && layer.scales)
    let active = layer.presence.shown
    content(active: active, rest: rest)
      .frame(width: rest.width, height: rest.height)
      .animation(shape.animation) { $0.modifier(follow) }
      .modifier(MiniPanelPresenceEffect(presence: layer.presence))
      .animation(nil) { $0.offset(x: rest.minX, y: rest.minY) }
      .allowsHitTesting(active)
      .accessibilityHidden(!active)
  }

  @ViewBuilder private func content(active: Bool, rest: CGRect) -> some View {
    if case .choose(let command) = layer.content, let card = layer.card ?? model.card {
      IslandCard(
        model: model, command: command, card: card, active: active && layer.card == nil,
        width: rest.width)
    } else if case .answer(let command, let answer, let note) = layer.content {
      IslandAnswerCard(
        model: model, command: command, answer: answer, note: note, width: rest.width,
        height: rest.height)
    } else if case .compose(let command, let attach) = layer.content {
      IslandComposeCard(
        model: model, command: command, attach: attach, active: active, width: rest.width,
        height: rest.height)
    } else {
      IslandCapsule(model: model, content: layer.content, limits: layer.limits)
    }
  }
}
