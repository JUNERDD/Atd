import AICore
import Observation
import SwiftUI

/// Discrete targets only. SwiftUI interpolates rendering; delayed stages never write geometry.
@MainActor @Observable
final class TaskActivityEntryPresence {
  var desired = false
  var visible = false
  var expanded = false
  var contentShown = false
  var interactive = false
  var opacity = 0.0
  var shapeAnimation: Animation?
  var contentAnimation: Animation?
  var opacityAnimation: Animation?
  @ObservationIgnored private var reduced = false
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var stages: Task<Void, Never>?

  let hiddenBlur = 3.0

  func setShown(_ shown: Bool, reducedMotion: Bool, immediate: Bool = false) {
    guard immediate || desired != shown || reduced != reducedMotion else { return }
    generation += 1
    let token = generation
    stages?.cancel()
    desired = shown
    reduced = reducedMotion
    interactive = false
    if immediate {
      shapeAnimation = nil
      contentAnimation = nil
      opacityAnimation = nil
      visible = shown
      expanded = shown
      contentShown = shown
      opacity = shown ? 1 : 0
      return
    }
    contentAnimation =
      shown
      ? MiniPanelChoreography.contentOpacity.animation
      : .easeIn(duration: MiniPanelChoreography.rows.exit)
    opacityAnimation =
      reducedMotion
      ? .easeOut(duration: shown ? 0.2 : 0.075) : MiniPanelMotion.popoverOpacity(shown)
    if shown {
      shapeAnimation = reducedMotion ? nil : MiniPanelChoreography.flyoutOpen.animation
      visible = true
      expanded = true
      opacity = 1
      stages = Task { [weak self] in
        guard let self else { return }
        if !reducedMotion {
          try? await Task.sleep(for: .seconds(MiniPanelChoreography.rows.delay))
        }
        guard !Task.isCancelled, token == generation else { return }
        contentShown = true
        try? await Task.sleep(for: .milliseconds(reducedMotion ? 200 : 277))
        guard !Task.isCancelled, token == generation else { return }
        interactive = true
      }
    } else {
      contentShown = false
      opacity = 0
      stages = Task { [weak self] in
        guard let self else { return }
        let delay = MiniPanelChoreography.rows.exit
        try? await Task.sleep(for: .seconds(delay))
        guard !Task.isCancelled, token == generation else { return }
        shapeAnimation = reducedMotion ? nil : MiniPanelChoreography.labelLeave.animation
        expanded = false
        if !reducedMotion {
          // Keep the zero-contour tail mounted until the nominal 200 ms spring settles.
          try? await Task.sleep(
            for: .seconds(MiniPanelMotion.settling(MiniPanelChoreography.labelLeave)))
        }
        guard !Task.isCancelled, token == generation else { return }
        visible = false
        opacity = 0
      }
    }
  }
}
