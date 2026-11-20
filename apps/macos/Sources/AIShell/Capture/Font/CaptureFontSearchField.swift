import AppKit

/// Spacious `30 pt` search pill for the font picker with click-to-focus input, trailing clear
/// control, and focus-ring feedback that keeps active canvas text selection safe until clicked.
@MainActor
final class CaptureFontSearchField: NSView, NSTextFieldDelegate {
  var onQueryChanged: ((String) -> Void)?
  var onCommand: ((NSTextView, Selector) -> Bool)?
  var onFocusChanged: ((Bool) -> Void)?

  var query: String {
    get { textField.stringValue }
    set {
      if textField.stringValue != newValue { textField.stringValue = newValue }
      if let editor = textField.currentEditor(), editor.string != newValue {
        editor.string = newValue
      }
      syncClearVisibility()
    }
  }

  var placeholder: String {
    get { textField.placeholderString ?? "" }
    set {
      textField.placeholderString = newValue
      textField.setAccessibilityLabel(newValue)
    }
  }

  var clearAccessibilityLabel: String = "" {
    didSet {
      clearButton.setAccessibilityLabel(clearAccessibilityLabel)
      clearButton.image?.accessibilityDescription = clearAccessibilityLabel
    }
  }

  private(set) var isEditing = false {
    didSet {
      guard isEditing != oldValue else { return }
      updateChrome()
      onFocusChanged?(isEditing)
    }
  }

  private let iconView = NSImageView()
  private let textField = ClickToFocusSearchTextField()
  private let clearButton = SearchClearButton()
  private var displayObserver: NSObjectProtocol?
  private var windowObserver: NSObjectProtocol?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.cornerRadius = 8
    layer?.cornerCurve = .continuous

    iconView.imageScaling = .scaleNone
    iconView.contentTintColor = nil
    iconView.setAccessibilityElement(false)

    textField.isBordered = false
    textField.drawsBackground = false
    textField.focusRingType = .none
    textField.font = .systemFont(ofSize: 13)
    textField.textColor = .labelColor
    textField.maximumNumberOfLines = 1
    textField.usesSingleLineMode = true
    textField.cell?.wraps = false
    textField.cell?.isScrollable = true
    textField.delegate = self
    textField.onBecomeFirstResponder = { [weak self] in self?.isEditing = true }

    clearButton.isHidden = true
    clearButton.target = self
    clearButton.action = #selector(clearClicked)

    addSubview(iconView)
    addSubview(textField)
    addSubview(clearButton)
    updateChrome()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    super.viewWillMove(toWindow: newWindow)
    if let displayObserver { NSWorkspace.shared.notificationCenter.removeObserver(displayObserver) }
    if let windowObserver { NotificationCenter.default.removeObserver(windowObserver) }
    displayObserver = nil
    windowObserver = nil
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let window {
      displayObserver = NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.updateChrome() } }
      windowObserver = NotificationCenter.default.addObserver(
        forName: NSWindow.didResignKeyNotification,
        object: window,
        queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.stopTextEditing() } }
    }
    updateChrome()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateChrome()
  }

  override func layout() {
    super.layout()
    let w = bounds.width
    let h = bounds.height
    iconView.frame = NSRect(x: 7, y: floor((h - 16) * 0.5), width: 16, height: 16)
    clearButton.frame = NSRect(x: max(0, w - 29), y: (h - 28) * 0.5, width: 28, height: 28)
    let trailingEdge = clearButton.isHidden ? w - 8 : clearButton.frame.minX - 2
    let textH = ceil(textField.intrinsicContentSize.height)
    let textX: CGFloat = 26
    textField.frame = NSRect(
      x: textX,
      y: floor((h - textH) * 0.5),
      width: max(0, trailingEdge - textX),
      height: textH)
  }

  override func resetCursorRects() {
    let textRect =
      clearButton.isHidden
      ? bounds
      : NSRect(x: 0, y: 0, width: max(0, clearButton.frame.minX), height: bounds.height)
    addCursorRect(textRect, cursor: PointerRole.text.cursor)
  }

  override func mouseDown(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    if !clearButton.isHidden, clearButton.frame.contains(point) { return }
    focusInput()
  }

  func endEditingIfNeeded() {
    stopTextEditing()
    (window as? CapturePopoverPanel)?.releaseKeyFocus()
  }

  private func stopTextEditing() {
    textField.allowFocus = false
    if let window, window.firstResponder === textField.currentEditor() {
      window.endEditing(for: textField)
    }
    isEditing = false
  }

  func controlTextDidBeginEditing(_ obj: Notification) {
    isEditing = true
  }

  func controlTextDidChange(_ obj: Notification) {
    syncClearVisibility()
    onQueryChanged?(textField.stringValue)
  }

  func controlTextDidEndEditing(_ obj: Notification) {
    textField.allowFocus = false
    isEditing = false
  }

  func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
    onCommand?(textView, selector) ?? false
  }

  private func focusInput() {
    textField.allowFocus = true
    if let panel = window as? CapturePopoverPanel {
      if !panel.isKeyWindow || panel.firstResponder !== textField.currentEditor() {
        panel.requestKeyFocus(for: textField)
      }
    } else {
      window?.makeKey()
      if window?.firstResponder !== textField.currentEditor() {
        window?.makeFirstResponder(textField)
      }
    }
  }

  @objc private func clearClicked() {
    query = ""
    onQueryChanged?("")
  }

  private func syncClearVisibility() {
    let shouldHide = textField.stringValue.isEmpty
    guard clearButton.isHidden != shouldHide else { return }
    clearButton.isHidden = shouldHide
    needsLayout = true
    window?.invalidateCursorRects(for: self)
  }

  private func updateChrome() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      let increaseContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
      layer?.backgroundColor =
        NSColor.labelColor.withAlphaComponent(dark ? 0.07 : 0.045).cgColor
      if isEditing {
        layer?.borderWidth = 1.5
        layer?.borderColor = NSColor.controlAccentColor.withAlphaComponent(0.85).cgColor
      } else if increaseContrast {
        layer?.borderWidth = 1
        layer?.borderColor = NSColor.separatorColor.cgColor
      } else {
        layer?.borderWidth = 0.75
        layer?.borderColor = NSColor.labelColor.withAlphaComponent(0.10).cgColor
      }
      iconView.contentTintColor = nil
      iconView.image = tintedSymbolImage(
        "magnifyingglass", pointSize: 12.5, weight: .medium, color: .secondaryLabelColor)
    }
  }
}

/// Borderless input field that only accepts first responder when explicitly clicked.
@MainActor
private final class ClickToFocusSearchTextField: NSTextField {
  var allowFocus = false
  var onBecomeFirstResponder: (() -> Void)?

  override var acceptsFirstResponder: Bool { allowFocus }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func becomeFirstResponder() -> Bool {
    let accepted = super.becomeFirstResponder()
    if accepted { onBecomeFirstResponder?() }
    return accepted
  }

  override func mouseDown(with event: NSEvent) {
    allowFocus = true
    if let panel = window as? CapturePopoverPanel {
      if !panel.isKeyWindow || panel.firstResponder !== currentEditor() {
        panel.requestKeyFocus(for: self)
      }
    } else {
      window?.makeKey()
      if window?.firstResponder !== currentEditor() {
        window?.makeFirstResponder(self)
      }
    }
    super.mouseDown(with: event)
  }
}

/// Non-focus-stealing clear button with hover and press feedback inside `CaptureFontSearchField`.
@MainActor
private final class SearchClearButton: NSButton {
  private var trackingArea: NSTrackingArea?
  private var isHovered = false {
    didSet {
      if isHovered != oldValue { updateTint() }
    }
  }

  override var isHighlighted: Bool {
    didSet {
      if isHighlighted != oldValue { updateTint() }
    }
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    refusesFirstResponder = true
    isBordered = false
    title = ""
    setButtonType(.momentaryChange)
    imagePosition = .imageOnly
    imageScaling = .scaleNone
    contentTintColor = nil
    updateTint()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateTint()
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: (isEnabled ? PointerRole.action : PointerRole.passive).cursor)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { isHovered = true }
  override func mouseExited(with event: NSEvent) { isHovered = false }

  private func updateTint() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let tint: NSColor =
        isHighlighted ? .labelColor : isHovered ? .secondaryLabelColor : .tertiaryLabelColor
      contentTintColor = nil
      image = tintedSymbolImage(
        "xmark.circle.fill", pointSize: 13, weight: .regular, color: tint,
        accessibilityDescription: accessibilityLabel())
    }
  }
}

private func tintedSymbolImage(
  _ name: String, pointSize: CGFloat, weight: NSFont.Weight, color: NSColor,
  accessibilityDescription: String? = nil
) -> NSImage? {
  let resolved = NSColor(cgColor: color.cgColor) ?? color
  let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
    .applying(NSImage.SymbolConfiguration(paletteColors: [resolved]))
  let image = NSImage(systemSymbolName: name, accessibilityDescription: accessibilityDescription)?
    .withSymbolConfiguration(config)
  image?.isTemplate = false
  return image
}
