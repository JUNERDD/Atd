import AICore
import AppKit
import SwiftUI

/// The text command's result card in the capture overlay (``CaptureResultCardView``), a view of
/// the bars' host that the editor places (``show(_:at:beside:)``) and that stands over its stage's
/// lane (``CaptureResultStage``), the card entering, leaving and morphing there into its copied
/// capsule. Only where the card or capsule rests takes the pointer, and not while it leaves. Its
/// controls follow the pointer with the overlay window's own clock (``CaptureOverlayPanel`` is a
/// ``FloatingHoverHost``), so the overlay leaves the cursor over it to them (``cursor(at:)``). A
/// field of the card's (the review's adjust field) keeps its editing keys while it has the
/// keyboard; the canvases leave them to it.
final class CaptureResultCardHost: NSView {
  private let hosting: NSHostingView<CaptureResultCardView>
  private let stage: CaptureResultStage
  private let model: CaptureResultCardModel

  init(model: CaptureResultCardModel) {
    let stage = CaptureResultStage()
    self.stage = stage
    self.model = model
    hosting = NSHostingView(rootView: CaptureResultCardView(model: model, stage: stage))
    super.init(frame: .zero)
    hosting.sizingOptions = []
    addSubview(hosting)
    setAccessibilityElement(false)
    stage.onLane = { [weak self] lane in
      guard let self else { return }
      frame = lane
      hosting.frame = bounds
    }
  }

  /// Where the card or capsule rests, in the superview's coordinates; empty while nothing shows.
  var placed: CGRect { stage.placed }

  /// Shows `kind` resting at `frame` (the superview's coordinates), standing `beside` that side of
  /// the selection (nil: none): entering when nothing shows, else morphing from what showed.
  func show(
    _ kind: CaptureResultFace.Kind, at frame: CGRect, beside side: CaptureResultPlacement.Side?
  ) {
    stage.show(kind, at: frame, beside: side, reduceMotion: model.reduceMotion)
    isHidden = false
  }

  /// Nothing shows: what showed leaves, and the host hides once it has; what shows next enters
  /// where it is placed.
  func hide() {
    stage.leave(reduceMotion: model.reduceMotion) { [weak self] in self?.isHidden = true }
  }

  /// Where the card or capsule takes the pointer: where it rests, unless it is leaving.
  private func takes(_ point: CGPoint) -> Bool { !stage.leaving && placed.contains(point) }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func layout() {
    super.layout()
    hosting.frame = bounds
  }

  /// The lane's room around the card, and the card leaving, take no press: what is under it does.
  override func hitTest(_ point: NSPoint) -> NSView? {
    guard takes(point) else { return nil }
    return super.hitTest(point)
  }

  // A press, a drag or the wheel the card's controls leave goes no further: the overlay under
  // the card would start a selection or walk the detected areas with it.
  override func mouseDown(with event: NSEvent) {}
  override func mouseDragged(with event: NSEvent) {}
  override func mouseUp(with event: NSEvent) {}
  override func rightMouseDown(with event: NSEvent) {}
  override func scrollWheel(with event: NSEvent) {}

  /// The overlay's cursor over the card at `point` (the host's coordinates): none over a control,
  /// whose hover region sets its own, else the arrow; nil off the card or while it leaves.
  func cursor(at point: CGPoint) -> NSCursor? {
    guard !isHidden, takes(point) else { return nil }
    let hovered = (window as? any FloatingHoverHost)?.hoverRegions.hoveredWindow != nil
    return hovered ? nil : PointerRole.passive.cursor
  }

  /// ⌘V, ⌘X, ⌘C, ⌘A, ⌘Z and ⇧⌘Z edit the card's field while it has the keyboard, ahead of the
  /// Edit menu, as the ask field's do (``AnnotationAskBar``); while an input method composes, the
  /// keys are its.
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard event.type == .keyDown, let editor = window?.firstResponder as? NSTextView,
      editor.isFieldEditor, !editor.hasMarkedText(),
      editor.isDescendant(of: self) || (editor.delegate as? NSView)?.isDescendant(of: self) == true,
      let key = event.charactersIgnoringModifiers?.lowercased()
    else { return super.performKeyEquivalent(with: event) }
    switch (event.modifierFlags.intersection([.command, .control, .option, .shift]), key) {
    case (.command, "v"): editor.paste(nil)
    case (.command, "x"): editor.cut(nil)
    case (.command, "c"): editor.copy(nil)
    case (.command, "a"): editor.selectAll(nil)
    case (.command, "z"): editor.undoManager?.undo()
    case ([.command, .shift], "z"): editor.undoManager?.redo()
    default: return super.performKeyEquivalent(with: event)
    }
    return true
  }
}
