import AICore
import AppKit
import QuartzCore
import SwiftUI

/// The mini panel's choreography (motion-v3 at perf-v1's pace): one living body that morphs from
/// shape to shape on per-axis springs, with content that rides inside it, scaling with it, waits
/// for the shape when it opens and leaves before it when it closes. Each change sets the targets
/// and their animations once; SwiftUI runs them, so the controller writes nothing while anything
/// moves.
extension MiniPanelController {
  /// Moves the state machine to `phase`, choreographs the change and logs it with its cause.
  func transition(to phase: MiniPanelPhase, trigger: String) {
    let from = model.phase
    guard phase != from else { return }
    let name = stateName
    if model.flyoutOpen {
      // A dragged capsule keeps its card's place; anything else takes the card in with it.
      let into = phase == .dragging ? nil : Self.shape(for: phase).flatMap(restRect(of:))
      closeFlyout(trigger: nil, into: into)
    }
    model.phase = phase
    model.activeContent = Self.content(for: phase)
    model.pressed = nil
    // Only the open capsule has labels: any other state takes one down at once.
    if phase != .expanded { dropLabel() }
    if !phase.isDragging, lifted, snap == nil { setLifted(false) }
    choreograph(from: from, to: phase)
    activityPhaseChanged()
    updateDropZone()
    hover.reset()
    if phase != .target { magnet.reset() }
    pointer.wake()
    logState(from: name, trigger: trigger)
  }

  /// The body's shape in each phase.
  static func shape(for phase: MiniPanelPhase) -> MiniPanelShape? {
    switch phase {
    case .hidden: nil
    case .tucked, .draggingPill: .pill
    case .expanded, .dragging: .capsule
    case .invite: .invite
    case .target, .absorbing: .target
    }
  }

  /// The body content each phase shows; the pill shows none.
  static func content(for phase: MiniPanelPhase) -> MiniPanelContent? {
    switch phase {
    case .hidden, .tucked, .draggingPill: nil
    case .expanded, .dragging: .capsule
    case .invite: .invite
    case .target, .absorbing: .card
    }
  }

  private static func moment(from old: MiniPanelShape, to new: MiniPanelShape) -> MiniPanelMoment {
    switch (old, new) {
    case (_, .pill): .collapse
    case (.target, .invite): .untarget
    case (_, .invite): .invite
    case (_, .target): .target
    default: .expand
    }
  }

  /// A shape's frame at rest, in the glass container.
  func restRect(of shape: MiniPanelShape) -> CGRect? {
    layout.map { local($0.rect(of: shape)) }
  }

  private func choreograph(from: MiniPanelPhase, to phase: MiniPanelPhase) {
    guard let shape = Self.shape(for: phase) else { return hideBody() }
    guard let old = Self.shape(for: from) else { return placeBody(shape) }
    guard old != shape else { return }
    let moment = Self.moment(from: old, to: shape)
    var arrival = MiniPanelChoreography.content(moment)
    if let leaving = Self.content(for: from) {
      conceal(leaving, arrival)
      // The table times arrivals into an empty shape; content that was there leaves first.
      if moment == .expand || moment == .invite {
        arrival = MiniPanelContentMotion(
          delay: max(arrival.delay, arrival.exit), exit: arrival.exit)
      }
    }
    morphBody(
      to: shape, motion: MiniPanelChoreography.shape(moment, reduceMotion: model.reduceMotion))
    if let arriving = Self.content(for: phase) { reveal(arriving, arrival) }
  }

  /// Morphs the body to `shape`, each axis on its own spring after its own delay.
  func morphBody(to shape: MiniPanelShape, motion: MiniPanelShapeMotion) {
    guard let layout, let rect = restRect(of: shape) else { return }
    model.body = MiniPanelBodyShape(
      frame: rect, corner: layout.cornerRadius(of: shape), animation: motion.animation)
    bodyShape = shape
  }

  /// Puts the body in `shape` at once: shown, or laid out again.
  func placeBody(_ shape: MiniPanelShape) {
    guard let layout, let rect = restRect(of: shape) else { return }
    model.body = MiniPanelBodyShape(frame: rect, corner: layout.cornerRadius(of: shape))
    bodyShape = shape
  }

  private func hideBody() {
    bodyShape = nil
    bodyPressed = false
    lifted = false
    // Nothing still waiting may bring the card or the label back while the panel is gone.
    labelToken += 1
    model.body = MiniPanelBodyShape()
    model.bodyFactors = MiniPanelBodyFactors()
    for content in MiniPanelContent.allCases { model.setPresence(content, MiniPanelPresence()) }
    model.popover.hide()
    model.label = MiniPanelLabelShape()
  }

  // MARK: Content

  /// `content` arrives as `motion` has it, from wherever it is.
  func reveal(_ content: MiniPanelContent, _ motion: MiniPanelContentMotion) {
    model.setPresence(content, MiniPanelPresence(shown: true, motion: motion))
  }

  /// `content` leaves as `motion` has it, at once.
  func conceal(_ content: MiniPanelContent, _ motion: MiniPanelContentMotion) {
    guard model.presence(content).shown else { return }
    model.setPresence(content, MiniPanelPresence(shown: false, motion: motion))
  }

  // MARK: The commands card

  /// As a popover does, the card grows out of its anchor beside the capsule, level with the
  /// Commands button (``closedFlyoutFrame``), its fill with its glass, never out of the capsule,
  /// whose fill its own would darken where the two overlap; its rows arrive just after. The
  /// button's label, when out, becomes the card: the card takes its bubble's place in the same
  /// frame and grows from there as the label's text fades out over it, so no label is left beside
  /// it; any other label goes at once.
  func openFlyout() {
    guard model.phase == .expanded, !model.flyoutOpen, let card = layout?.flyout else { return }
    let from = stateName
    let bubble = takeLabelBubble(of: .commands)
    model.popover.place(
      rest: local(card), anchor: closedFlyoutFrame ?? .zero, reducedMotion: model.reduceMotion)
    model.popover.open(from: bubble)
    activityLayoutChanged()
    logState(from: from, trigger: "commands")
  }

  /// The rows leave first, then the card closes into `rect` (the body's new shape) when the
  /// capsule changes too, and goes once it has landed. Otherwise it leaves into its anchor, as the
  /// hover label does (the shared popup lifecycle), never into the capsule, where its fill would darken
  /// the capsule's. Either way it then waits at its anchor. `trigger` logs the change; nil when a
  /// state change logs it.
  func closeFlyout(trigger: String?, into rect: CGRect? = nil) {
    guard model.flyoutOpen else { return }
    let from = stateName
    model.popover.close(into: rect)
    activityLayoutChanged()
    if let trigger { logState(from: from, trigger: trigger) }
  }

  /// Where the closed card waits, shrunk to nothing: its anchor, which it grows out of and leaves
  /// into, the middle of its side facing the capsule level with the Commands button (kept clear of
  /// its rounded corners), so it never lies over the capsule.
  var closedFlyoutFrame: CGRect? {
    guard let layout, let flyout = layout.flyout, let commands = layout.buttons.last else {
      return nil
    }
    let card = local(flyout)
    let level = local(commands).midY
    let inset = min(MiniPanelMetrics.cardRadius, card.height / 2)
    let y = min(max(level, card.minY + inset), card.maxY - inset)
    return CGRect(x: layout.edge == .right ? card.maxX : card.minX, y: y, width: 0, height: 0)
  }

  // MARK: Touch

  /// A press goes in at once: the body squishes, content and all, under a press on its surface,
  /// a control's glyph under a press on it. Reduce Motion keeps the body still; the control's
  /// wash still shows.
  func showPress(_ target: MiniPanelPress) {
    switch target {
    case .activityEntry:
      model.activity?.setEntryPressed(true)
    case .body(nil):
      guard !model.reduceMotion else { return }
      bodyPressed = true
      setBodyScale(
        MiniPanelChoreography.bodyPressScale, MiniPanelChoreography.bodyPress.animation)
    case .body(let control?), .card(let control?):
      model.pressed = control
    case .none, .card(nil), .scroller, .dropShape:
      break
    }
  }

  /// The press comes back out, bouncing.
  func endPress() {
    model.activity?.setEntryPressed(false)
    model.pressed = nil
    guard bodyPressed else { return }
    bodyPressed = false
    guard !lifted else { return }
    setBodyScale(1, MiniPanelChoreography.bodyRelease.animation)
  }

  /// The body lifts as a drag begins, and settles with the snap. Reduce Motion keeps its size.
  func setLifted(_ lifted: Bool) {
    self.lifted = lifted
    bodyPressed = false
    if lifted, !model.reduceMotion {
      setBodyScale(MiniPanelChoreography.liftScale, MiniPanelChoreography.lift.animation)
    } else {
      let snap = MiniPanelChoreography.snap.reduced(model.reduceMotion)
      setBodyScale(1, snap.animation)
    }
  }

  private func setBodyScale(_ scale: Double, _ animation: Animation) {
    guard model.bodyFactors.scale != scale else { return }
    model.bodyFactors.scale = scale
    model.body.animation = animation
  }

  /// Deforms the glass alone (the release's stretch, the drop's squash) on `animation`.
  func deform(_ factors: CGSize, _ animation: Animation) {
    guard model.bodyFactors.deform != factors else { return }
    model.bodyFactors.deform = factors
    model.body.animation = animation
  }
}
