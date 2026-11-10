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
  /// The shape morphs to `target`'s on `motion`, and what shows arrives once it rests.
  func morph(to target: WindowSize, motion: MiniPanelShapeMotion, card: Bool) {
    let from = model.shape
    model.shape = IslandShape(
      frame: IslandMetrics.rest(target), corner: IslandMetrics.corner(target, card: card),
      animation: motion.animation(thickness: .vertical))
    let change = MiniPanelShapeAxis.vertical.extent(of: (model.shape.glass - from.glass).components)
    shapeMoves(
      settling: MiniPanelAxisAnimation.restTime(motion, across: change.across, along: change.along))
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
  /// later so that it is drawn at rest.
  func shapeMoves(settling seconds: Double) {
    let rests = CACurrentMediaTime() + seconds + MiniPanelMotion.frame
    guard rests > shapeRests else { return }
    shapeRests = rests
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(max(rests - CACurrentMediaTime(), 0)))
      guard let self, shapeRests == rests else { return }
      model.arrived = true
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
