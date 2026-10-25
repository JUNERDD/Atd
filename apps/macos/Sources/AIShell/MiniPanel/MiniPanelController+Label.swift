import AICore
import AppKit
import QuartzCore
import SwiftUI

/// The hover label (hover-label-v1, its way in and out from hover-label-v4): the panel's own
/// tooltip, since AppKit delays or drops an inactive app's tooltips and Atd stays inactive while
/// the panel is used. A capsule button's name, or a commands row's full name when the card cuts it
/// short, shows beside the capsule (or the card) toward the interior after the pointer rests on it
/// (``MiniPanelLabelTimer``). As a popover does, the label grows out of an anchor on its side
/// facing the capsule, level with the hovered control, glides from control to control while warm
/// with its text cross-fading, and leaves into that anchor, never over the capsule
/// (``MiniPanelLabelPath``). A press, a drag, the panel closing, the card opening over it or a
/// drag session sends it away at once, except that a press on Commands keeps it for the card to
/// grow out of. It is visual only: the controls keep their own labels.
extension MiniPanelController {
  /// One frame of the label, with the control under the pointer. Writes only when the label
  /// changes.
  func updateLabel(at now: Double) {
    let hovered = model.hovered
    let item = hovered.flatMap { labels($0) ? $0 : nil }
    let suppressed = suppressesLabel(hovered)
    let previous = labelTimer.shown
    // Suppressed, the label stays away from the control under the pointer until the pointer
    // leaves it, as after a click, even from one that has no label now: Commands under its open
    // card does not show its label as soon as a click on it closes the card.
    let shown = labelTimer.update(
      item: suppressed ? hovered : item, suppressed: suppressed, at: now)
    if shown != previous {
      showLabel(shown, hadLabel: previous != nil)
    } else if shown == nil, let item, !model.label.drawn,
      model.label.fade < 1 || model.label.text != labelText(item)
    {
      // Warming up: the hidden label waits at the rest it will grow into, so it starts there.
      // Checked by its text alone on every frame; showing it checks its rest too.
      seedLabel(for: item)
    }
  }

  /// Whether `control` has a label now: a capsule button while the card is closed, a row whose
  /// name the open card cuts short.
  private func labels(_ control: MiniPanelControl) -> Bool {
    if case .row(let index) = control { return model.flyoutOpen && truncatedRows.contains(index) }
    return !model.flyoutOpen
  }

  private func suppressesLabel(_ hovered: MiniPanelControl?) -> Bool {
    if window?.isPressing == true || model.phase != .expanded || snap != nil || menuOpen
      || dragWatch.session != nil
    {
      return true
    }
    // The open card covers where a capsule button's label would show.
    if model.flyoutOpen, let hovered, !Self.isRow(hovered) { return true }
    return false
  }

  private static func isRow(_ control: MiniPanelControl) -> Bool {
    if case .row = control { return true }
    return false
  }

  /// The label's text: the control's name, or the row's command name, which is user data.
  private func labelText(_ control: MiniPanelControl) -> String {
    switch control {
    case .mark: model.markLabel
    case .newTask: model.labels.newTask
    case .ask: model.labels.ask
    case .screenshot: model.labels.screenshot
    case .commands: model.labels.commands
    case .row(let index): commands.indices.contains(index) ? commands[index].name : ""
    }
  }

  /// The middle of `control`, which its label is level with, and the shape the label shows beside
  /// (the capsule, or the card for a row), in global points.
  private func labelAnchor(_ control: MiniPanelControl) -> (point: CGPoint, beside: ScreenRect)? {
    guard let layout else { return nil }
    if case .row(let index) = control {
      guard let card = layout.flyout else { return nil }
      let middle =
        card.maxY - MiniPanelMetrics.cardPadding
        - (Double(index) + 0.5) * MiniPanelMetrics.rowHeight + model.flyoutScroll
      return (CGPoint(x: card.x + card.width / 2, y: middle), card)
    }
    let buttons = MiniPanelControl.buttons(hasCommands: !commands.isEmpty)
    guard let index = buttons.firstIndex(of: control), layout.buttons.indices.contains(index)
    else { return nil }
    let button = layout.buttons[index]
    return (
      CGPoint(x: button.x + button.width / 2, y: button.y + button.height / 2), layout.capsule
    )
  }

  /// Where `control`'s label rests, out of sight, in the glass container. Measures the text, so
  /// it runs only when the label changes.
  private func labelShape(_ control: MiniPanelControl) -> MiniPanelLabelShape? {
    guard let layout, let anchor = labelAnchor(control) else { return nil }
    let text = labelText(control)
    let font = NSFont.systemFont(ofSize: MiniPanelMetrics.labelTextSize, weight: .medium)
    let measured = (text as NSString).size(withAttributes: [.font: font]).width
    let width = Double(measured.rounded(.up)) + MiniPanelMetrics.labelPadding * 2
    let rest = layout.hoverLabel(beside: anchor.beside, centerY: anchor.point.y, width: width)
    let lane = labelLane(beside: anchor.beside, middle: anchor.point.x, edge: layout.edge)
    return MiniPanelLabelShape(text: text, rest: local(rest), lane: local(lane))
  }

  /// Where any label beside `shape` can show, its controls' middles at `middle`: from the
  /// farthest a label reaches to those middles, along the whole shape, with room for the
  /// entrance's overshoot. The label view's fixed frame.
  private func labelLane(beside shape: ScreenRect, middle: Double, edge: MiniPanelEdge)
    -> ScreenRect
  {
    let room = MiniPanelMetrics.labelHeight
    let reach = MiniPanelMetrics.labelGap + MiniPanelMetrics.labelMaxWidth + room
    let minX = edge == .right ? shape.x - reach : middle - room
    let maxX = edge == .right ? middle + room : shape.maxX + reach
    return ScreenRect(
      x: minX, y: shape.y - room, width: maxX - minX, height: shape.height + room * 2)
  }

  /// The hidden label already waits, out of sight, at `control`'s label's rest with its text.
  private func isSeeded(as shape: MiniPanelLabelShape) -> Bool {
    model.label.fade == 1 && model.label.text == shape.text && model.label.rest == shape.rest
  }

  /// Puts the hidden label at `control`'s label's rest, out of sight, with its text gone.
  private func seedLabel(for control: MiniPanelControl) {
    guard let shape = labelShape(control) else { return }
    model.label = shape
    model.setPresence(
      .labelText, MiniPanelPresence(shown: false, motion: MiniPanelChoreography.labelText))
  }

  /// Shows `control`'s label (nil hides it): growing out of its anchor, or gliding there from the
  /// control it showed for, or from where it was leaving, coming back as it glides.
  private func showLabel(_ control: MiniPanelControl?, hadLabel: Bool) {
    guard let control, let shape = labelShape(control) else { return hideLabel() }
    labelToken += 1
    let token = labelToken
    let reduce = model.reduceMotion
    let kind = Self.isRow(control) ? "row" : control.identifier
    Self.log.debug("Mini panel hover label: \(kind, privacy: .public)")
    if hadLabel || model.label.drawn {
      // On screen, or still leaving: it glides to the new control, its text cross-fading.
      model.label = MiniPanelLabelShape(
        text: shape.text, rest: shape.rest, lane: shape.lane, fade: 0, drawn: true,
        animation: MiniPanelChoreography.labelGlide.reduced(reduce).animation)
      reveal(.labelText, MiniPanelChoreography.labelText)
      return
    }
    let appear = { [weak self] in
      guard let self, token == labelToken else { return }
      var label = model.label
      label.fade = 0
      label.drawn = true
      label.animation = MiniPanelChoreography.labelAppear.reduced(reduce).animation
      model.label = label
      reveal(.labelText, MiniPanelChoreography.labelText)
    }
    guard isSeeded(as: shape) else {
      // The hidden label must be drawn at its rest before it grows into it.
      seedLabel(for: control)
      Task {
        try? await Task.sleep(for: .seconds(MiniPanelMotion.frame))
        appear()
      }
      return
    }
    appear()
  }

  /// The label leaves into its anchor without overshoot: its text fades as it draws a little
  /// toward the anchor, then it draws in to nothing there, fill and glass together, never over
  /// the capsule; it then waits out of sight at its rest. Anything still waiting to show it
  /// stops.
  private func hideLabel() {
    labelToken += 1
    conceal(.labelText, MiniPanelChoreography.labelText)
    guard model.label.drawn else { return }
    Self.log.debug("Mini panel hover label: hidden")
    let token = labelToken
    let leave = MiniPanelChoreography.labelLeave
    var label = model.label
    label.fade = 1
    label.animation = leave.animation
    model.label = label
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(MiniPanelMotion.settling(leave)))
      guard let self, token == labelToken else { return }
      var label = model.label
      label.drawn = false
      label.animation = nil
      model.label = label
    }
  }

  /// Takes the label away at once, mid-appear or mid-glide alike, and keeps it away over the
  /// control under the pointer until the pointer leaves it: a press, a drag, a state change, the
  /// card opening over it, or the context menu.
  func dropLabel() {
    let hovered = model.hovered
    _ = labelTimer.update(item: hovered, suppressed: true, at: CACurrentMediaTime())
    hideLabel()
  }

  // MARK: The commands card

  /// How long a held label waits after its press for the card: the press's click is replayed
  /// after the release, so the card opens a few frames later.
  static let labelHoldGrace = 0.2

  /// A press on Commands, whose click grows the card out of the button's label: the label stays
  /// as it is, text and all, so no empty bubble waits on the press, until the card takes it
  /// (``takeLabelBubble(of:)``) or the press ends without one (``releaseHeldLabel()``).
  func holdLabel() {
    _ = labelTimer.update(item: model.hovered, suppressed: true, at: CACurrentMediaTime())
    labelToken += 1
  }

  /// A held label that no card took once the press's click has run leaves as any label does.
  func releaseHeldLabel() {
    guard model.label.drawn, model.label.fade == 0 else { return }
    let token = labelToken
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(Self.labelHoldGrace))
      guard let self, token == labelToken, model.label.drawn, !model.flyoutOpen else { return }
      hideLabel()
    }
  }

  /// Takes `control`'s label, if it is out, for the card that grows out of it: the card takes the
  /// bubble's place in the same frame and grows around it while the label's text fades out over
  /// it. The card takes sole ownership of the glass immediately, keeping the handoff opaque
  /// without overlapping rims. Otherwise the label goes as a press takes it. Returns where
  /// the bubble rests, in the glass container.
  func takeLabelBubble(of control: MiniPanelControl) -> CGRect? {
    guard model.label.drawn, !model.label.bubbleTaken, model.label.fade == 0,
      model.label.rest == labelShape(control)?.rest
    else {
      dropLabel()
      return nil
    }
    _ = labelTimer.update(item: model.hovered, suppressed: true, at: CACurrentMediaTime())
    labelToken += 1
    let token = labelToken
    let text = MiniPanelChoreography.labelText
    model.label.bubbleTaken = true
    conceal(.labelText, text)
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(text.exit))
      guard let self, token == labelToken else { return }
      var label = model.label
      label.fade = 1
      label.drawn = false
      label.animation = nil
      model.label = label
    }
    return model.label.rest
  }
}
