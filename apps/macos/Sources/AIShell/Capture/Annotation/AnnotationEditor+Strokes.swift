import AICore
import AppKit

/// What changes the style and the size of what the style bar targets, and clears the whole
/// document: the bar itself, the scroll wheel and the keys that step the size.
extension AnnotationEditor {
  /// A style bar change: it restyles the open text, else the selected annotation, and becomes
  /// the style of the next new annotation of the same slot. Only the part picked changes.
  /// Changes sharing a `burst` (a size slider drag, a run of wheel ticks) are one undo step.
  func restyle(_ change: AnnotationStyleChange, burst: UUID? = nil) {
    if let editing = textEditor.style {
      interaction.styles.shared = change.applied(to: interaction.styles.shared)
      textEditor.setStyle(change.applied(to: editing))
    } else {
      interaction.apply(change, burst: burst)
      focusCanvas()
    }
    refresh()
  }

  /// `[` `-` and `]` `=`: one wheel notch smaller or larger (PixPin's keys for a wheel), one undo
  /// step each, for whatever the style bar targets; none at either end. False when the bar
  /// shows no size.
  func stepStroke(_ direction: Int) -> Bool {
    resize(by: Double(direction), burst: nil)
  }

  /// The scroll wheel anywhere over the overlay while the style bar shows a size, as in PixPin:
  /// the same as dragging the size slider, one ``AnnotationStroke/stepped(by:)`` step per wheel
  /// notch (or per 20 pt of trackpad travel), up for larger. A run of ticks no more than half a
  /// second apart, or one trackpad gesture, is one undo step; momentum after a flick is ignored,
  /// so the size stops where the fingers did. False when there is no size to change, so the
  /// session keeps the wheel.
  func scroll(_ event: NSEvent) -> Bool {
    guard styleTarget?.controls.contains(.strokes) == true else { return false }
    guard event.momentumPhase.isEmpty else { return true }
    if event.phase == .began || (event.phase.isEmpty && event.timestamp - lastWheel > 0.5) {
      wheelBurst = UUID()
    }
    lastWheel = event.timestamp
    // Physical direction: up is larger whether or not scrolling is natural.
    let delta = event.isDirectionInvertedFromDevice ? -event.scrollingDeltaY : event.scrollingDeltaY
    let steps = event.hasPreciseScrollingDeltas ? delta / 20 : delta
    guard steps != 0 else { return true }
    return resize(by: Double(steps), burst: wheelBurst)
  }

  /// Moves the size `steps` steps (``AnnotationStroke/stepped(by:)``); false when the style bar
  /// shows no size, so the key or the wheel goes on to the session.
  private func resize(by steps: Double, burst: UUID?) -> Bool {
    guard let target = styleTarget, target.controls.contains(.strokes) else { return false }
    let stroke = target.style.stroke.stepped(by: steps)
    if stroke != target.style.stroke {
      restyle(AnnotationStyleChange(stroke: stroke), burst: burst)
    }
    return true
  }

  /// ⌘Delete: open text is committed first, then the whole document goes as one undo step.
  /// False when there was neither text nor an annotation.
  func clearAll() -> Bool {
    let wasEditing = textEditor.isEditing
    textEditor.end()
    let cleared = interaction.clearAll()
    refreshPointer()
    return wasEditing || cleared
  }
}
