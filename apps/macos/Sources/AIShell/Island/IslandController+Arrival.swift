import AICore
import AppKit
import SwiftUI

/// When the content that shows arrives (``IslandModel/arrived``): once the shape that brings it
/// has come to rest. Until then the shape's motion scales and moves the content
/// (``MiniPanelFollowEffect``), and SwiftUI gives that geometry to the AppKit text fields in it
/// through an ancestor, their own frames unchanged. A field that took the keyboard meanwhile
/// would have AppKit lay its field editor out, pixel-aligned, for a scale that then goes away,
/// and nothing lays the editor out again while editing lasts: its text, placeholder and caret
/// would stay off by up to half a pixel over that scale (a card growing out of the working
/// capsule is at about a quarter of its size a frame in). So a card's field takes the keyboard
/// once its content has arrived, and what is typed before then waits for it
/// (``IslandWindow/awaitsField``).
extension IslandController {
  /// Runs `body` inside an animation-disabled SwiftUI transaction so off-screen resets or
  /// canvas changes never trigger unintended transitions.
  func withoutAnimation(_ body: () -> Void) {
    var transaction = Transaction(animation: nil)
    transaction.disablesAnimations = true
    withTransaction(transaction, body)
  }

  /// Updates `layer` for an in-place content change and returns the resize motion if the shape
  /// or a shell card's internal layout changed; otherwise nil.
  func prepareInPlaceUpdate(
    layer: inout IslandLayer, next: IslandContent, target: WindowSize, inPlace: Bool
  ) -> MiniPanelShapeMotion? {
    let previousShellLayout = layer.shellCard?.layout
    let nextShellCard = model.shellCard(for: next)
    layer.shellCard = nextShellCard
    let shellLayoutChanged = previousShellLayout != nextShellCard?.layout
    guard target != size || shellLayoutChanged else { return nil }
    layer.rest = IslandMetrics.rest(target)
    // An arrived review card lays out at its shape as drawn, on the direct edits' spring: its
    // title stays on the top edge, its field and footer on the bottom, its answer takes the rest.
    let reflows = next.kind == .review && model.arrived
    let staysInPlace = inPlace || next.resizesInPlace || reflows
    layer.scales = !staysInPlace
    layer.reflows = reflows
    if (reflows || shellLayoutChanged) && !model.reduceMotion {
      model.layoutMotion = .interpolated
    }
    let resize = staysInPlace ? IslandChoreography.inPlace : IslandChoreography.resize
    return MiniPanelShapeMotion(
      thickness: resize.thickness.reduced(model.reduceMotion),
      length: resize.length.reduced(model.reduceMotion))
  }

  /// The shape morphs to `target`'s on `motion`, and what shows arrives once it rests.
  func morph(
    to target: WindowSize, motion: MiniPanelShapeMotion, card: Bool, minSettling: Double = 0
  ) {
    let from = model.shape
    model.shape = IslandShape(
      frame: IslandMetrics.rest(target), corner: IslandMetrics.corner(target, card: card),
      animation: motion.animation(thickness: .vertical))
    let change = MiniPanelShapeAxis.vertical.extent(of: (model.shape.glass - from.glass).components)
    let settling = max(
      MiniPanelAxisAnimation.restTime(motion, across: change.across, along: change.along),
      minSettling)
    shapeMoves(settling: settling)
    size = target
    if let anchor {
      let inside = clamped(anchor, size: target)
      if inside != anchor {
        self.anchor = inside
        placeWindow()
      }
    }
  }

  /// The shape moves and comes to rest `seconds` from now. A motion adds to those still running
  /// (``MiniPanelAxisAnimation``), so what shows arrives once the last of them has ended, a frame
  /// later so that it is drawn at rest. Once settled, interpolated layout motion resets to fixed
  /// and excess canvas headroom is trimmed so idle cards pay no per-frame evaluation cost.
  func shapeMoves(settling seconds: Double) {
    let rests = CACurrentMediaTime() + seconds + MiniPanelMotion.frame
    guard rests > shapeRests else { return }
    shapeRests = rests
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(max(rests - CACurrentMediaTime(), 0)))
      guard let self, shapeRests == rests, !exiting, window.isVisible else { return }
      model.arrived = true
      window.hoverReady = true
      window.pointerHover.refresh()
      withoutAnimation {
        if model.layoutMotion != .fixed { model.layoutMotion = .fixed }
        if model.shape.animation != nil { model.shape.animation = nil }
        if let size, model.layers.count <= 1, !isShellAnswerStreaming {
          fitCanvas(to: size)
        }
      }
    }
  }

  /// Whether `content` has a field that takes the keyboard once it arrives: the compose card's
  /// text, the review card's adjust field, and the options card's filter when its list is long.
  func takesTyping(_ content: IslandContent) -> Bool {
    switch content {
    case .compose, .review: true
    case .choose: model.card?.showsFilter == true
    default: false
    }
  }
}
