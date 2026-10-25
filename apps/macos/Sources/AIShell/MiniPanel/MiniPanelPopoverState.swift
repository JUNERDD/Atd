import AICore
import AppKit
import Observation
import SwiftUI

/// The Command popover's lifecycle, shared by each popup instance. Business state and placement
/// stay with the caller; only this owner schedules handoff, departure and retirement.
@MainActor @Observable
final class MiniPanelPopoverState {
  private(set) var isOpen = false
  private(set) var visible = false
  private(set) var expanded = false
  private(set) var shape = MiniPanelCardShape()
  private(set) var presence = MiniPanelPresence(motion: MiniPanelChoreography.rows)
  private(set) var rest = CGRect.zero
  private(set) var anchor = CGRect.zero
  private(set) var reducedMotion = false
  /// The open card's last placement was a resize the caller asked to spring (``place(rest:
  /// anchor:reducedMotion:resize:)``): its glass moves to the new frame on that animation, and
  /// its content lands there at once. Cleared by any other placement, opening, closing or hiding.
  private(set) var resizing = false
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var stages: Task<Void, Never>?

  var interactive: Bool { isOpen }
  var opacity: Double { isOpen ? 1 : 0 }

  /// Places the card. Layout changes land at the new resting frame, as the original Command card
  /// does. A caller may pass `resize` to let an open card spring to its new frame instead, for a
  /// change of its own content; without Reduce Motion only, and never for a closed card.
  func place(rest: CGRect, anchor: CGRect, reducedMotion: Bool, resize: Animation? = nil) {
    let moved = self.rest != rest || self.anchor != anchor
    let changedMotion = self.reducedMotion != reducedMotion
    self.rest = rest
    self.anchor = anchor
    self.reducedMotion = reducedMotion
    if moved || changedMotion {
      invalidate()
      let springs = resize != nil && isOpen && !changedMotion && !reducedMotion
      resizing = springs
      shape = MiniPanelCardShape(frame: isOpen ? rest : anchor, animation: springs ? resize : nil)
      expanded = isOpen
      visible = isOpen
    }
  }

  func open(from bubble: CGRect? = nil) {
    guard !isOpen else { return }
    invalidate()
    let token = generation
    isOpen = true
    visible = true
    expanded = true
    presence = MiniPanelPresence(shown: true, motion: MiniPanelChoreography.rows)
    let arrival = MiniPanelCardShape(
      frame: rest, animation: MiniPanelChoreography.flyoutOpen.reduced(reducedMotion).animation,
      isLabelHandoff: bubble != nil && !reducedMotion)
    guard let bubble, !reducedMotion else {
      shape = arrival
      return
    }
    shape = MiniPanelCardShape(frame: bubble, isLabelHandoff: true)
    stages = Task { [weak self] in
      try? await Task.sleep(for: .seconds(MiniPanelMotion.frame))
      guard let self, !Task.isCancelled, token == generation, isOpen else { return }
      shape = arrival
    }
  }

  func close(into body: CGRect? = nil) {
    guard isOpen else { return }
    invalidate()
    let token = generation
    isOpen = false
    presence = MiniPanelPresence(shown: false, motion: MiniPanelChoreography.rows)
    let delay = MiniPanelChoreography.flyoutCloseDelay
    let leave = (body == nil ? MiniPanelChoreography.labelLeave : MiniPanelChoreography.flyoutClose)
      .reduced(reducedMotion)
    if let body {
      shape = MiniPanelCardShape(frame: body, animation: leave.animation.delay(delay))
      expanded = false
    }
    stages = Task { [weak self] in
      try? await Task.sleep(for: .seconds(delay))
      guard let self, !Task.isCancelled, token == generation, !isOpen else { return }
      if body == nil {
        shape = MiniPanelCardShape(frame: anchor, animation: leave.animation)
        expanded = false
      }
      try? await Task.sleep(for: .seconds(MiniPanelMotion.settling(leave)))
      guard !Task.isCancelled, token == generation, !isOpen else { return }
      shape = MiniPanelCardShape(frame: anchor)
      visible = false
    }
  }

  func hide() {
    invalidate()
    isOpen = false
    visible = false
    expanded = false
    presence = MiniPanelPresence(motion: MiniPanelChoreography.rows)
    shape = MiniPanelCardShape(frame: anchor)
  }

  private func invalidate() {
    resizing = false
    generation += 1
    stages?.cancel()
    stages = nil
  }
}
