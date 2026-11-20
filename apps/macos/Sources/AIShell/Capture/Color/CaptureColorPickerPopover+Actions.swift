import AICore
import AppKit

extension CaptureColorPickerPopover {
  @objc func swatchClicked(_ sender: CaptureColorSwatchWell) {
    guard let color = sender.color else { return }
    applyPickedColor(color, burst: nil, commit: true, syncSpectrum: true)
  }

  @objc func eyedropperClicked() {
    dismissPopover()
    onRequestEyedropper?()
  }

  @objc func systemPanelClicked() {
    let colorPanel = NSColorPanel.shared
    if !isAttachedToSystemPanel {
      savedSystemPanelLevel = colorPanel.level
      savedSystemPanelHidesOnDeactivate = colorPanel.hidesOnDeactivate
    }
    isAttachedToSystemPanel = true
    colorPanel.showsAlpha = true
    colorPanel.hidesOnDeactivate = false
    isSyncingSystemPanel = true
    colorPanel.color = currentColor.nsColor
    isSyncingSystemPanel = false
    colorPanel.setTarget(self)
    colorPanel.setAction(#selector(systemPanelColorChanged(_:)))
    let minLevel = max(panel.level.rawValue + 1, colorPanel.level.rawValue)
    colorPanel.level = NSWindow.Level(rawValue: minLevel)
    colorPanel.orderFront(nil)
  }

  func handlePanelClosed() {
    isEditingHex = false
    didCancelHexEdit = false
    hexField.allowFocus = false
    refreshLayerColors()
    detachSystemPanel()
    onClose?()
  }

  private func detachSystemPanel() {
    guard isAttachedToSystemPanel else { return }
    isAttachedToSystemPanel = false
    systemPanelBurst = nil
    guard NSColorPanel.sharedColorPanelExists else { return }
    let colorPanel = NSColorPanel.shared
    colorPanel.setTarget(nil)
    colorPanel.setAction(nil)
    if let savedSystemPanelLevel { colorPanel.level = savedSystemPanelLevel }
    if let savedSystemPanelHidesOnDeactivate {
      colorPanel.hidesOnDeactivate = savedSystemPanelHidesOnDeactivate
    }
    savedSystemPanelLevel = nil
    savedSystemPanelHidesOnDeactivate = nil
    if colorPanel.isVisible { colorPanel.orderOut(nil) }
  }

  @objc private func systemPanelColorChanged(_ sender: NSColorPanel) {
    guard !isSyncingSystemPanel else { return }
    let srgb = sender.color.usingColorSpace(.sRGB) ?? sender.color
    let rgba = AnnotationRGBA(
      red: Double(srgb.redComponent), green: Double(srgb.greenComponent),
      blue: Double(srgb.blueComponent), alpha: Double(srgb.alphaComponent))
    switch NSApp.currentEvent?.type {
    case .leftMouseDragged:
      let burst = systemPanelBurst ?? UUID()
      systemPanelBurst = burst
      applyPickedColor(rgba, burst: burst, commit: false, syncSpectrum: true)
    case .leftMouseUp where systemPanelBurst != nil:
      let burst = systemPanelBurst
      systemPanelBurst = nil
      applyPickedColor(rgba, burst: burst, commit: true, syncSpectrum: true)
    default:
      systemPanelBurst = nil
      applyPickedColor(rgba, burst: nil, commit: true, syncSpectrum: true)
    }
  }

  func controlTextDidBeginEditing(_ obj: Notification) {
    isEditingHex = true
    didCancelHexEdit = false
    refreshLayerColors()
  }

  func controlTextDidEndEditing(_ obj: Notification) {
    isEditingHex = false
    let cancelled = didCancelHexEdit
    didCancelHexEdit = false
    if !cancelled { commitHexField() }
    hexField.endFocus()
    refreshLayerColors()
  }

  func control(_ control: NSControl, textView: NSTextView, doCommandBy cmd: Selector) -> Bool {
    if cmd == #selector(NSResponder.insertNewline(_:)) {
      isEditingHex = false
      didCancelHexEdit = false
      commitHexField()
      hexField.endFocus()
      refreshLayerColors()
      return true
    }
    if cmd == #selector(NSResponder.cancelOperation(_:)) {
      isEditingHex = false
      didCancelHexEdit = true
      hexField.stringValue = currentColor.hexString
      hexField.endFocus()
      refreshLayerColors()
      return true
    }
    return false
  }

  private func commitHexField() {
    guard
      let parsed = AnnotationRGBA.parseHex(hexField.stringValue, fallbackAlpha: currentColor.alpha)
    else {
      hexField.stringValue = currentColor.hexString
      return
    }
    hexField.stringValue = parsed.hexString
    applyPickedColor(parsed, burst: nil, commit: true, syncSpectrum: true)
  }
}

/// Borderless `#HEX` input that keeps capture/canvas focus intact until explicitly clicked.
@MainActor
final class ClickToFocusHexTextField: NSTextField {
  var allowFocus = false

  override var acceptsFirstResponder: Bool { allowFocus }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: PointerRole.text.cursor)
  }

  override func mouseDown(with event: NSEvent) {
    allowFocus = true
    if let panel = window as? CapturePopoverPanel {
      if !panel.isKeyWindow || panel.firstResponder !== currentEditor() {
        panel.requestKeyFocus(for: self)
      }
    } else if window?.firstResponder !== currentEditor() {
      window?.makeFirstResponder(self)
    }
    super.mouseDown(with: event)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard event.type == .keyDown, let editor = currentEditor() as? NSTextView,
      window?.firstResponder === editor, !editor.hasMarkedText(),
      let key = event.charactersIgnoringModifiers?.lowercased()
    else { return super.performKeyEquivalent(with: event) }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    switch (modifiers, key) {
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

  func endFocus() {
    allowFocus = false
    (window as? CapturePopoverPanel)?.releaseKeyFocus()
  }
}

/// Flipped popover container notifying when effective appearance updates its CGColor layers.
@MainActor
final class CaptureFlippedPopoverView: NSView {
  var onAppearanceChange: (() -> Void)?
  override var isFlipped: Bool { true }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    onAppearanceChange?()
  }
}
