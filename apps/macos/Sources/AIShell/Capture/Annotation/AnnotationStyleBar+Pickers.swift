import AICore
import AppKit

/// Compact adaptive pill button shared by ``AnnotationStyleBar`` (font family selector pill) and
/// ``CaptureColorPickerPopover`` (eyedropper and system color panel buttons). Never steals focus.
@MainActor
final class CaptureCompactPillButton: NSButton {
  var isCapsule: Bool { didSet { needsDisplay = true } }
  var leadingBadge: String? {
    didSet { if leadingBadge != oldValue { updateSizing() } }
  }
  var leadingIcon: NSImage? { didSet { updateSizing() } }
  var trailingIcon: NSImage? { didSet { updateSizing() } }
  var labelText: String {
    didSet { if labelText != oldValue { updateSizing() } }
  }
  var maxLabelWidth: CGFloat {
    didSet { if maxLabelWidth != oldValue { updateSizing() } }
  }
  var isSelected = false {
    didSet { if isSelected != oldValue { needsDisplay = true } }
  }
  override var isEnabled: Bool {
    didSet {
      if isEnabled != oldValue { window?.invalidateCursorRects(for: self) }
    }
  }

  private let pillHeight: CGFloat
  private let cornerRadius: CGFloat
  private let explicitWidth: CGFloat?
  private var isHovered = false
  private var trackingArea: NSTrackingArea?
  private var widthConstraint: NSLayoutConstraint?

  init(
    height: CGFloat = 28,
    isCapsule: Bool = true,
    cornerRadius: CGFloat = 6,
    usesAutoLayout: Bool = true,
    explicitWidth: CGFloat? = nil,
    leadingBadge: String? = nil,
    leadingIcon: NSImage? = nil,
    labelText: String = "",
    trailingIcon: NSImage? = nil,
    maxLabelWidth: CGFloat = 92,
    action: Selector
  ) {
    self.pillHeight = height
    self.isCapsule = isCapsule
    self.cornerRadius = cornerRadius
    self.explicitWidth = explicitWidth
    self.leadingBadge = leadingBadge
    self.leadingIcon = leadingIcon
    self.labelText = labelText
    self.trailingIcon = trailingIcon
    self.maxLabelWidth = maxLabelWidth
    let initW = explicitWidth ?? height
    super.init(frame: NSRect(x: 0, y: 0, width: initW, height: height))
    setButtonType(.momentaryChange)
    isBordered = false
    title = ""
    self.action = action
    translatesAutoresizingMaskIntoConstraints = !usesAutoLayout
    if usesAutoLayout {
      widthConstraint = widthAnchor.constraint(equalToConstant: initW)
      widthConstraint?.isActive = true
      heightAnchor.constraint(equalToConstant: height).isActive = true
    }
    updateSizing()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override var intrinsicContentSize: NSSize { NSSize(width: computedWidth(), height: pillHeight) }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: PointerRole(button: self).cursor)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) {
    isHovered = true
    needsDisplay = true
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
    needsDisplay = true
  }

  private static let badgeFont = NSFont.systemFont(ofSize: 11, weight: .semibold)
  private static let textFont = NSFont.systemFont(ofSize: 11.5, weight: .medium)

  private func updateSizing() {
    let w = computedWidth()
    widthConstraint?.constant = w
    if translatesAutoresizingMaskIntoConstraints {
      setFrameSize(NSSize(width: w, height: pillHeight))
    }
    invalidateIntrinsicContentSize()
    needsDisplay = true
  }

  private func computedWidth() -> CGFloat {
    if let explicitWidth { return explicitWidth }
    let iconSide: CGFloat = 13
    let chevronSide: CGFloat = 10
    let padX: CGFloat = (leadingBadge != nil || !labelText.isEmpty) ? 8 : 6
    var total = padX * 2
    var hasPrev = false
    if leadingIcon != nil {
      total += iconSide
      hasPrev = true
    }
    if let badge = leadingBadge, !badge.isEmpty {
      if hasPrev { total += 4 }
      total += ceil((badge as NSString).size(withAttributes: [.font: Self.badgeFont]).width)
      hasPrev = true
    }
    if !labelText.isEmpty {
      if hasPrev { total += 4 }
      let rawW = ceil((labelText as NSString).size(withAttributes: [.font: Self.textFont]).width)
      total += min(rawW, maxLabelWidth)
      hasPrev = true
    }
    if trailingIcon != nil {
      if hasPrev { total += 3 }
      total += chevronSide
    }
    return max(pillHeight, total)
  }

  override func draw(_ dirtyRect: NSRect) {
    let rect = bounds.insetBy(dx: 0.5, dy: 0.5)
    let r = isCapsule ? rect.height / 2 : cornerRadius
    let path = NSBezierPath(roundedRect: rect, xRadius: r, yRadius: r)
    let fillAlpha: CGFloat = isSelected ? 0.16 : isHighlighted ? 0.17 : isHovered ? 0.10 : 0.055
    let fillColor = isSelected ? NSColor.controlAccentColor : NSColor.labelColor
    fillColor.withAlphaComponent(fillAlpha).setFill()
    path.fill()
    path.lineWidth = 0.75
    let rimColor = isSelected ? NSColor.controlAccentColor : NSColor.labelColor
    rimColor.withAlphaComponent(isSelected ? 0.42 : 0.15).setStroke()
    path.stroke()

    let padX: CGFloat = (leadingBadge != nil || !labelText.isEmpty) ? 8 : 6
    var x = padX
    let textColor = isEnabled ? NSColor.labelColor : NSColor.secondaryLabelColor
    let iconX =
      (labelText.isEmpty && leadingBadge == nil && trailingIcon == nil)
      ? floor((bounds.width - 13) / 2) : x
    if let icon = leadingIcon {
      let tinted = AnnotationToolbarButton.Label.tinted(
        icon, textColor, size: NSSize(width: 13, height: 13))
      tinted.draw(
        in: NSRect(x: iconX, y: floor((bounds.height - 13) / 2), width: 13, height: 13))
      x += 17
    }
    if let badge = leadingBadge, !badge.isEmpty {
      let attrs: [NSAttributedString.Key: Any] = [
        .font: Self.badgeFont, .foregroundColor: NSColor.secondaryLabelColor,
      ]
      let sz = (badge as NSString).size(withAttributes: attrs)
      let by = floor((bounds.height - sz.height) / 2)
      (badge as NSString).draw(
        in: NSRect(x: x, y: by, width: sz.width, height: sz.height), withAttributes: attrs)
      x += ceil(sz.width) + 4
    }
    if !labelText.isEmpty {
      let pStyle = NSMutableParagraphStyle()
      pStyle.lineBreakMode = .byTruncatingTail
      let attrs: [NSAttributedString.Key: Any] = [
        .font: Self.textFont, .foregroundColor: textColor, .paragraphStyle: pStyle,
      ]
      let sz = (labelText as NSString).size(withAttributes: attrs)
      let maxW = max(12, bounds.width - x - padX - (trailingIcon == nil ? 0 : 13))
      let ly = floor((bounds.height - sz.height) / 2)
      (labelText as NSString).draw(
        in: NSRect(x: x, y: ly, width: maxW, height: sz.height), withAttributes: attrs)
    }
    if let chevron = trailingIcon {
      let tinted = AnnotationToolbarButton.Label.tinted(
        chevron, NSColor.secondaryLabelColor, size: NSSize(width: 10, height: 10))
      let cx = bounds.width - padX - 10
      let cy = floor((bounds.height - 10) / 2)
      tinted.draw(in: NSRect(x: cx, y: cy, width: 10, height: 10))
    }
  }
}

extension AnnotationStyleBar {
  @objc func colorWheelClicked() {
    onOpenColorWheel?(colorWheelAnchorView)
  }

  @objc func fontPickerClicked() {
    onOpenFontPicker?(fontPickerAnchorView)
  }

  func measureFormMetrics() -> CachedFormMetrics {
    let savedControls = controls
    defer { _ = showControls(savedControls) }
    let fontLabel = CaptureFontCatalog.shared.displayLabel(for: lastRenderedStyle.fontFamily)
    if extra.fontPicker.labelText != fontLabel {
      extra.fontPicker.labelText = fontLabel
    }
    _ = showControls([.mosaicMode, .redaction, .strokes])
    let mosaicSize = bar.fittingSize
    let mosaicBase = max(0, mosaicSize.width - redactCurrentWidth)
    var maxWidth: CGFloat = 0
    var maxHeight = mosaicSize.height
    let otherForms: [AnnotationStyleControls] = [
      [.colors, .strokes, .fillMode, .cornerStyle, .dashed],
      [.colors, .strokes, .arrowStyle, .dashed],
      [.colors, .strokes, .textBackground, .fontFamily],
      [.strokes, .spotlightShape, .spotlightDim, .cornerStyle],
      [.colors, .strokes, .stepConfig],
    ]
    for form in otherForms {
      _ = showControls(form)
      let size = bar.fittingSize
      maxWidth = max(maxWidth, size.width)
      maxHeight = max(maxHeight, size.height)
    }
    let metrics = CachedFormMetrics(
      mosaicBase: mosaicBase, otherMax: maxWidth, height: maxHeight)
    cachedFormMetrics = metrics
    return metrics
  }

  func resizeToFitIfAttached(layoutChanged: Bool) {
    guard layoutChanged || frame.size == .zero else { return }
    invalidateIntrinsicContentSize()
    guard let superview else { return }
    let target = fittingSize
    guard abs(frame.width - target.width) > 0.5 || abs(frame.height - target.height) > 0.5 else {
      return
    }
    var origin = frame.origin
    let maxX = superview.bounds.maxX - 8
    if origin.x + target.width > maxX {
      origin.x = max(8, maxX - target.width)
    }
    setFrameOrigin(origin)
    setFrameSize(target)
  }

  func applyPickerVisibility(for controls: AnnotationStyleControls) {
    let hideWheel = !controls.contains(.colors)
    if extra.colorWheel.isHidden != hideWheel { extra.colorWheel.isHidden = hideWheel }
    let hideFont = !controls.contains(.fontFamily)
    if extra.fontPicker.isHidden != hideFont { extra.fontPicker.isHidden = hideFont }
    let cfgMask: AnnotationStyleControls = [
      .spotlightShape, .spotlightDim, .stepConfig, .fontFamily,
    ]
    bar.setGroup(3, hidden: controls.intersection(cfgMask).isEmpty)
  }

  @discardableResult
  func updatePickerControls(style: AnnotationStyle, controls: AnnotationStyleControls) -> Bool {
    if controls.contains(.colors) {
      let wheelTitle = ShellStrings.shared.text(CaptureToolsStringKey.colorWheel)
      let custom = style.customColor
      let customActive = custom != nil
      if wheelCache?.title != wheelTitle || wheelCache?.color != custom
        || wheelCache?.customActive != customActive
      {
        wheelCache = (custom, customActive, wheelTitle)
        extra.colorWheel.image = AnnotationIcons.colorWheel(activeCustom: custom, label: wheelTitle)
        if extra.colorWheel.toolTip != nil { extra.colorWheel.toolTip = nil }
        extra.colorWheel.setAccessibilityLabel(
          custom.map { "\(wheelTitle) (\($0.hexString))" } ?? wheelTitle)
      }
      if extra.colorWheel.isSelected != customActive {
        extra.colorWheel.isSelected = customActive
      }
      if customActive {
        for button in colors where button.isSelected { button.isSelected = false }
      }
    }

    var fontWidthChanged = false
    if controls.contains(.fontFamily) {
      let fontLabel = CaptureFontCatalog.shared.displayLabel(for: style.fontFamily)
      let pickerTitle = ShellStrings.shared.text(CaptureToolsStringKey.fontPicker)
      if extra.fontPicker.trailingIcon == nil {
        extra.fontPicker.trailingIcon = AnnotationIcons.glyph(
          AnnotationIcons.chevronDown, label: pickerTitle)
      }
      if extra.fontPicker.labelText != fontLabel {
        extra.fontPicker.labelText = fontLabel
        invalidateFontMetrics()
        fontWidthChanged = true
      }
      if extra.fontPicker.toolTip != nil { extra.fontPicker.toolTip = nil }
      if lastFontPickerTitle != pickerTitle || fontWidthChanged {
        lastFontPickerTitle = pickerTitle
        extra.fontPicker.setAccessibilityLabel("\(pickerTitle): \(fontLabel)")
      }
    }
    return fontWidthChanged
  }
}
