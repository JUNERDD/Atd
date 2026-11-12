import AICore
import AppKit

/// The changing faces, room measurement and running indicator of ``AnnotationCommandRow``.
extension AnnotationCommandRow {
  /// Shows what Copy text or Copy just did, or its action again, at its reserved width.
  func showCopy(_ state: CopyState, tooltip: String? = nil) {
    let labels = Self.copyLabels(kind)
    let (label, icon): (String, String?) =
      switch state {
      case .idle: (labels[0], AnnotationIcons.copyText)
      case .copied: (labels[1], AnnotationIcons.confirm)
      case .noText: (labels[2], AnnotationIcons.copyText)
      }
    let image = kind == .screenshot ? icon.map { AnnotationIcons.glyph($0, label: "") } : nil
    copy.setLabel(label, image: image)
    copy.presentation =
      switch state {
      case .idle: .standard
      case .copied: .success
      case .noText: .muted
      }
    copy.toolTip = tooltip ?? Self.copyTooltip(kind)
    fit()
  }

  /// Select Text: enabled unless the selection was read and holds no text (`false`).
  func setSelectText(hasText: Bool?) {
    guard let selectText else { return }
    let none = hasText == false
    selectText.isEnabled = !none
    let strings = ShellStrings.shared
    selectText.toolTip = strings.text(
      none ? CaptureTextModeStringKey.selectTextNone : .selectTextTooltip)
  }

  /// The auto-redact shortcut's state; its group shows only while it covers or confirms.
  func setRedaction(_ state: Redaction) {
    guard let redact else { return }
    let strings = ShellStrings.shared
    switch state {
    case .hidden:
      break
    case .cover(let count):
      redact.setLabel(
        strings.text(CaptureTextModeStringKey.redact),
        image: AnnotationIcons.glyph(AnnotationIcons.autoRedact, label: ""))
      redact.toolTip = strings.text(CaptureTextModeStringKey.redactTooltip, count: count)
      redact.presentation = .standard
      redact.isEnabled = true
    case .done(let count):
      redact.setLabel(
        strings.text(.captureRedactDone, count: count),
        image: AnnotationIcons.glyph(AnnotationIcons.redacted, label: ""))
      redact.presentation = .success
      redact.isEnabled = false
    }
    bar.setHidden(state == .hidden, for: redact)
    fit()
  }

  /// The confirmation's tooltip (what was covered and how to undo it).
  func setRedactionTooltip(_ tooltip: String) { redact?.toolTip = tooltip }

  /// The scope chip's words.
  func setScope(_ label: String) {
    scope?.setLabel(label)
    fit()
  }

  /// The result card's toggle: shown once a run started, lit while the card shows.
  func setResults(visible: Bool, isOpen: Bool) {
    let visibilityChanged = results.isHidden != !visible
    if visibilityChanged { bar.setHidden(!visible, for: results) }
    if results.isSelected != isOpen { results.isSelected = isOpen }
    if visibilityChanged {
      fit()
      bar.layoutSubtreeIfNeeded()
      placeRunBar()
    }
  }

  /// The row at the size of what it shows now, in place: its host is flipped, so the top-left
  /// stays where the toolbar put it.
  func fit() {
    guard superview != nil else { return }
    setFrameSize(fittingSize)
  }

  /// The row with every part showing and each label that changes at its longest form (Copy's,
  /// the shortcut's at a two-digit count, the scope chip's, and the result toggle), measured once
  /// with the current language's copy; the parts then show their idle labels again.
  func widestSize() -> NSSize {
    let strings = ShellStrings.shared
    let copyImage =
      kind == .screenshot ? AnnotationIcons.glyph(AnnotationIcons.copyText, label: "") : nil
    let width = { (text: String) in
      AnnotationToolbarButton.Label.width(text: text, hasImage: copyImage != nil)
    }
    copy.setLabel(Self.copyLabels(kind).max { width($0) < width($1) } ?? "", image: copyImage)
    let redactImage = AnnotationIcons.glyph(AnnotationIcons.autoRedact, label: "")
    redact?.setLabel(strings.text(.captureRedactDone, count: 88), image: redactImage)
    scope?.setLabel(AnnotationScopeChip.widestLabel)
    let resultsHidden = results.isHidden
    let redactHidden = redact?.isHidden ?? false
    bar.setHidden(false, for: results)
    if let redact { bar.setHidden(false, for: redact) }
    let size = bar.fittingSize
    bar.setHidden(resultsHidden, for: results)
    if let redact { bar.setHidden(redactHidden, for: redact) }
    showCopy(.idle)
    redact?.setLabel(strings.text(CaptureTextModeStringKey.redact), image: redactImage)
    scope?.setLabel("")
    return size
  }

  /// The running bar under command `id`'s button, or under More when it sits there; nil hides it.
  func setRunning(_ id: String?) {
    let next: NSView? = id.map { buttons[$0] ?? more }
    guard next !== running else { return }
    running = next
    if running == nil {
      runBar.stop()
    } else {
      placeRunBar()
      runBar.start()
    }
  }

  /// 2 pt under the label, 9 pt in from the button's ends, 3 pt above its bottom edge.
  func placeRunBar() {
    guard let running, running.superview != nil else { return }
    let rect = convert(running.bounds, from: running)
    let y = isFlipped ? rect.maxY - 3 - 2 : rect.minY + 3
    runBar.frame = CGRect(x: rect.minX + 9, y: y, width: max(rect.width - 18, 0), height: 2)
  }
}
