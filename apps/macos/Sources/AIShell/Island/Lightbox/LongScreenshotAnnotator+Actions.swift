import AICore
import AppKit
import Carbon.HIToolbox

/// What the annotator's bars and keys do, as the screenshot editor does it
/// (``AnnotationEditor``): choosing a tool, restyling, stepping the size, clearing, and
/// auto-redact over the sensitive items the card found in the kept range.
extension LongScreenshotAnnotator {
  /// Whether the canvas acts on `event`, a key press, so the lightbox leaves it to the responder
  /// chain rather than using the key itself (↑ ↓ scroll and `-` `=` zoom there too): while
  /// drawing, every key while text is typed; else, without ⌘ ⌃ ⌥, a tool letter, Delete and the
  /// arrows while an annotation is selected under a tool, and `[` `]` `-` `=` while the style bar
  /// shows a size, as the editor's canvas takes them (``AnnotationCanvasView``). Escape is never
  /// the canvas's: the lightbox calls ``stepBack()``.
  func takesKey(_ event: NSEvent) -> Bool {
    guard active else { return false }
    if textEditor.isEditing { return true }
    let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard modifiers.isDisjoint(with: [.command, .control, .option]) else { return false }
    let selected = interaction.tool != nil && store.selectedID != nil
    switch Int(event.keyCode) {
    case kVK_Escape, kVK_Return, kVK_ANSI_KeypadEnter:
      return false
    case kVK_Delete, kVK_ForwardDelete, kVK_LeftArrow, kVK_RightArrow, kVK_DownArrow,
      kVK_UpArrow:
      return selected
    default:
      let characters = event.charactersIgnoringModifiers ?? ""
      if ["[", "-", "_", "]", "=", "+"].contains(characters) {
        return styleTarget?.controls.contains(.strokes) == true
      }
      return AnnotationTool(key: characters) != nil
    }
  }

  /// Picks a tool, or drops it (nil): open text ends and a gesture in progress goes.
  func choose(_ tool: AnnotationTool?) {
    textEditor.end()
    styleBar.endRedactionFeedback()
    interaction.cancelGesture()
    interaction.tool = tool
    refreshPointer()
    refresh()
    focusCanvas()
  }

  /// A style bar change: it restyles the open text, else the selected annotation, and becomes
  /// the style of the next new annotation of the same slot. Changes sharing a `burst` (a size
  /// slider drag) are one undo step.
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

  /// `[` `-` and `]` `=`: one step smaller or larger, one undo step each, for whatever the style
  /// bar targets; false when it shows no size, so the key goes on.
  func stepStroke(_ direction: Int) -> Bool {
    guard let target = styleTarget, target.controls.contains(.strokes) else { return false }
    let stroke = target.style.stroke.stepped(by: Double(direction))
    if stroke != target.style.stroke { restyle(AnnotationStyleChange(stroke: stroke)) }
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

  // MARK: Auto-redact

  /// The mosaics' rects (image points).
  private var mosaics: [CGRect] {
    store.document.annotations.compactMap { annotation in
      if case .mosaic(let rect) = annotation.shape { rect } else { nil }
    }
  }

  /// The sensitive items in the kept range that no mosaic hides.
  var unmaskedSensitive: [SensitiveText.Box] {
    SensitiveText.uncovered(card.state.keptSensitive, by: mosaics)
  }

  /// The mosaic tool's dot and the style bar's auto-redact, as the card's text and the kept range
  /// stand: the card read the image's text before it showed, so it is never still reading.
  func refreshRedaction() {
    let unmasked = unmaskedSensitive
    toolbar.setSensitiveCount(unmasked.count)
    styleBar.setRedaction(
      !unmasked.isEmpty
        ? .cover(unmasked.count) : card.state.keptSensitive.isEmpty ? .none : .allCovered)
  }

  /// Covers every unmasked sensitive item with a mosaic a few points past it, as one undo step,
  /// then says so on the button pressed, as the editor's does (decision D7). From the style bar
  /// the mosaic takes the style it shows; from the bottom bar's shortcut, outside the mosaic tool,
  /// the mosaic tool's remembered style, whether or not annotate mode ever opened.
  func redactSensitive(fromStyleBar: Bool = true) {
    let hits = unmaskedSensitive
    guard !hits.isEmpty else { return }
    textEditor.end()
    let remembered = IslandLongScreenshotCardModel.mosaicStyle(defaults)
    let style = fromStyleBar && active ? styleTarget?.style ?? remembered : remembered
    store.commit(store.document.redacting(hits, style: style))
    card.confirmRedaction(hits.count)
    let strings = ShellStrings.shared
    let said =
      strings.text(.captureRedactDone, count: hits.count) + " · "
      + strings.text(.captureRedactUndoHint)
    styleBar.confirmRedaction(count: hits.count, tooltip: said)
    NSAccessibility.post(
      element: NSApplication.shared, notification: .announcementRequested,
      userInfo: [.announcement: said, .priority: NSAccessibilityPriorityLevel.high.rawValue])
  }
}
