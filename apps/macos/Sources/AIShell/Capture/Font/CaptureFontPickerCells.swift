import AppKit

/// Interactive `34 pt` font row aligned with the picker header, with neutral menu washes,
/// keyboard focus rim, font preview title, metadata tag, and unified trailing slot.
@MainActor
final class FontRowCellView: NSTableCellView {
  private static let badgeFont = NSFont.systemFont(ofSize: 11, weight: .regular)

  private let highlightView = NSView()
  private let titleLabel = NSTextField(labelWithString: "")
  private let badgeLabel = NSTextField(labelWithString: "")
  private let checkmarkView = NSImageView()
  private let statusIconView = NSImageView()
  private let spinner = NSProgressIndicator()

  private var isSelectable = true
  private var isRowSelected = false
  private var isHovered = false
  private var isPressed = false
  private var isKeyboardHighlighted = false
  private var currentStatus: CaptureGoogleFontStatus?
  private var trackingArea: NSTrackingArea?

  init(identifier: NSUserInterfaceItemIdentifier) {
    super.init(frame: .zero)
    self.identifier = identifier
    wantsLayer = true
    layer?.masksToBounds = false
    highlightView.wantsLayer = true
    highlightView.layer?.cornerRadius = 8
    highlightView.layer?.cornerCurve = .continuous

    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.maximumNumberOfLines = 1
    titleLabel.usesSingleLineMode = true
    titleLabel.cell?.truncatesLastVisibleLine = true

    badgeLabel.font = Self.badgeFont
    badgeLabel.textColor = .secondaryLabelColor
    badgeLabel.alignment = .right
    badgeLabel.lineBreakMode = .byTruncatingTail
    badgeLabel.maximumNumberOfLines = 1
    badgeLabel.usesSingleLineMode = true

    for icon in [checkmarkView, statusIconView] {
      icon.imageScaling = .scaleNone
      icon.isHidden = true
      icon.setAccessibilityElement(false)
    }
    spinner.style = .spinning
    spinner.controlSize = .small
    spinner.isDisplayedWhenStopped = false

    for subview in [highlightView, titleLabel, badgeLabel, checkmarkView, statusIconView, spinner] {
      addSubview(subview)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() {
    addCursorRect(bounds, cursor: (isSelectable ? PointerRole.action : PointerRole.passive).cursor)
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    isHovered = false
    isPressed = false
    isKeyboardHighlighted = false
    isRowSelected = false
    currentStatus = nil
    checkmarkView.isHidden = true
    statusIconView.isHidden = true
    spinner.stopAnimation(nil)
    refreshHighlightAppearance()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    syncHoverFromPointer()
    refreshHighlightAppearance()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    refreshHighlightAppearance()
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
    syncHoverFromPointer()
    refreshHighlightAppearance()
  }

  override func mouseEntered(with event: NSEvent) {
    guard isSelectable else { return }
    isHovered = true
    refreshHighlightAppearance()
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
    refreshHighlightAppearance()
  }

  override func layout() {
    super.layout()
    let rowRect = resolvedRowRect()
    let h = bounds.height
    highlightView.frame = NSRect(x: rowRect.minX, y: 1, width: rowRect.width, height: max(0, h - 2))

    let titleX = rowRect.minX + 6
    let slotSide: CGFloat = 16
    let slotX = rowRect.maxX - 8 - slotSide
    let slotRect = NSRect(x: slotX, y: (h - slotSide) * 0.5, width: slotSide, height: slotSide)
    checkmarkView.frame = slotRect
    statusIconView.frame = slotRect
    spinner.frame = slotRect

    var rx = slotX - 6
    if !badgeLabel.isHidden {
      let badgeWidth = ceil(
        (badgeLabel.stringValue as NSString).size(withAttributes: [.font: Self.badgeFont]).width)
      let bw = min(badgeWidth + 6, 88)
      let bh = ceil(badgeLabel.intrinsicContentSize.height)
      rx -= bw
      badgeLabel.frame = NSRect(x: rx, y: (h - bh) * 0.5, width: bw, height: bh)
      rx -= 8
    }

    let th = min(max(14, h - 4), ceil(titleLabel.intrinsicContentSize.height))
    titleLabel.frame = NSRect(x: titleX, y: (h - th) * 0.5, width: max(0, rx - titleX), height: th)
  }

  func configure(
    title: String, font: NSFont = .systemFont(ofSize: 14), color: NSColor = .labelColor,
    badge: String? = nil, status: CaptureGoogleFontStatus? = nil, selected: Bool = false,
    keyboardHighlighted: Bool = false, selectable: Bool = true
  ) {
    isSelectable = selectable
    isRowSelected = selected
    isKeyboardHighlighted = keyboardHighlighted
    currentStatus = status

    titleLabel.stringValue = title
    titleLabel.font = font
    titleLabel.textColor = color
    let trimmedBadge = badge?.isEmpty == false ? badge : nil
    badgeLabel.stringValue = trimmedBadge ?? ""
    badgeLabel.isHidden = trimmedBadge == nil

    updateTrailingSlot()
    setAccessibilityElement(true)
    setAccessibilityRole(selectable ? .button : .staticText)
    setAccessibilityLabel(trimmedBadge.map { "\(title), \($0)" } ?? title)
    setAccessibilityValue(NSNumber(value: selected))

    syncHoverFromPointer()
    refreshHighlightAppearance()
    window?.invalidateCursorRects(for: self)
    needsLayout = true
  }

  func setSelected(_ selected: Bool) {
    guard isRowSelected != selected else { return }
    isRowSelected = selected
    updateTrailingSlot()
    setAccessibilityValue(NSNumber(value: selected))
    refreshHighlightAppearance()
  }

  func setPressed(_ pressed: Bool) {
    guard isPressed != pressed else { return }
    isPressed = pressed
    refreshHighlightAppearance()
  }

  func setKeyboardHighlighted(_ highlighted: Bool) {
    guard isKeyboardHighlighted != highlighted else { return }
    isKeyboardHighlighted = highlighted
    refreshHighlightAppearance()
  }

  func refreshHighlightAppearance() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      let highContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
      highlightView.layer?.backgroundColor =
        highlightFillColor(dark: dark, highContrast: highContrast).cgColor

      if isKeyboardHighlighted && isSelectable {
        highlightView.layer?.borderWidth = 1.5
        highlightView.layer?.borderColor =
          NSColor.controlAccentColor.withAlphaComponent(0.85).cgColor
      } else if isRowSelected && highContrast && isSelectable {
        highlightView.layer?.borderWidth = 1
        highlightView.layer?.borderColor =
          NSColor.labelColor.withAlphaComponent(dark ? 0.45 : 0.35).cgColor
      } else {
        highlightView.layer?.borderWidth = 0
        highlightView.layer?.borderColor = nil
      }
      refreshTrailingGlyphs()
    }
  }

  private func highlightFillColor(dark: Bool, highContrast: Bool) -> NSColor {
    guard isSelectable else { return .clear }
    if isPressed { return NSColor.labelColor.withAlphaComponent(dark ? 0.16 : 0.12) }
    if isRowSelected {
      let alpha: CGFloat =
        highContrast
        ? (dark ? 0.18 : 0.14) : isHovered ? (dark ? 0.14 : 0.10) : (dark ? 0.12 : 0.08)
      return NSColor.labelColor.withAlphaComponent(alpha)
    }
    if isKeyboardHighlighted { return NSColor.labelColor.withAlphaComponent(dark ? 0.10 : 0.07) }
    if isHovered { return NSColor.labelColor.withAlphaComponent(dark ? 0.08 : 0.05) }
    return .clear
  }

  private func updateTrailingSlot() {
    let statusOverridesCheckmark =
      currentStatus == .loading || currentStatus == .failed || currentStatus == .remote
    checkmarkView.isHidden = !isRowSelected || statusOverridesCheckmark
    if currentStatus == .loading { spinner.startAnimation(nil) } else { spinner.stopAnimation(nil) }
    statusIconView.isHidden = currentStatus != .remote && currentStatus != .failed
  }

  private func refreshTrailingGlyphs() {
    checkmarkView.image =
      checkmarkView.isHidden
      ? nil : Self.tintedSymbol("checkmark", size: 11.5, weight: .semibold, color: .labelColor)
    switch currentStatus {
    case .remote:
      statusIconView.image = Self.tintedSymbol(
        "arrow.down.circle", size: 13.5, weight: .regular, color: .secondaryLabelColor)
    case .failed:
      statusIconView.image = Self.tintedSymbol(
        "arrow.clockwise.circle", size: 13.5, weight: .medium, color: .systemOrange)
    case .loading, .cached, nil:
      statusIconView.image = nil
    }
  }

  private func syncHoverFromPointer() {
    guard isSelectable, let window, window.isVisible, !isHiddenOrHasHiddenAncestor,
      window.frame.contains(NSEvent.mouseLocation)
    else {
      isHovered = false
      return
    }
    let local = convert(window.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
    let visible = visibleRect.intersection(bounds)
    isHovered = !visible.isEmpty && visible.contains(local)
  }

  static func symbol(_ name: String, size: CGFloat, weight: NSFont.Weight) -> NSImage? {
    let config = NSImage.SymbolConfiguration(pointSize: size, weight: weight)
    let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
      .withSymbolConfiguration(config)
    image?.isTemplate = true
    return image
  }

  private static func tintedSymbol(
    _ name: String, size: CGFloat, weight: NSFont.Weight, color: NSColor
  ) -> NSImage? {
    let resolved = NSColor(cgColor: color.cgColor) ?? color
    let config = NSImage.SymbolConfiguration(pointSize: size, weight: weight)
      .applying(NSImage.SymbolConfiguration(paletteColors: [resolved]))
    let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
      .withSymbolConfiguration(config)
    image?.isTemplate = false
    return image
  }
}

/// Centered empty-state row (`112 pt` tall) for Recent and no-match search results.
@MainActor
final class EmptyFontRowCellView: NSTableCellView {
  private let iconView = NSImageView()
  private let messageLabel = NSTextField(wrappingLabelWithString: "")

  init(identifier: NSUserInterfaceItemIdentifier) {
    super.init(frame: .zero)
    self.identifier = identifier
    iconView.imageScaling = .scaleProportionallyDown
    iconView.contentTintColor = .secondaryLabelColor
    iconView.setAccessibilityElement(false)
    messageLabel.font = .systemFont(ofSize: 12.5)
    messageLabel.textColor = .secondaryLabelColor
    messageLabel.alignment = .center
    messageLabel.maximumNumberOfLines = 2
    messageLabel.lineBreakMode = .byWordWrapping
    addSubview(iconView)
    addSubview(messageLabel)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { false }
  override func resetCursorRects() { addCursorRect(bounds, cursor: PointerRole.passive.cursor) }

  override func layout() {
    super.layout()
    let rowRect = resolvedRowRect()
    let w = rowRect.width
    let x = rowRect.minX
    let msgH = ceil(
      messageLabel.sizeThatFits(NSSize(width: max(120, w - 48), height: .greatestFiniteMagnitude))
        .height)
    let topY = floor((bounds.height - (26 + 8 + msgH)) * 0.5)
    iconView.frame = NSRect(x: x + floor((w - 26) * 0.5), y: topY, width: 26, height: 26)
    messageLabel.frame = NSRect(x: x + 24, y: topY + 34, width: max(0, w - 48), height: msgH)
  }

  func configure(symbolName: String, message: String) {
    iconView.image = FontRowCellView.symbol(symbolName, size: 22, weight: .regular)
    messageLabel.stringValue = message
    setAccessibilityElement(true)
    setAccessibilityRole(.staticText)
    setAccessibilityLabel(message)
    needsLayout = true
  }
}

extension NSTableCellView {
  /// Returns the scroll clip view's horizontal content span in this cell's coordinate space.
  fileprivate func resolvedRowRect() -> NSRect {
    guard let clip = enclosingScrollView?.contentView else { return bounds }
    return convert(NSRect(x: 0, y: 0, width: clip.bounds.width, height: bounds.height), from: clip)
  }
}
