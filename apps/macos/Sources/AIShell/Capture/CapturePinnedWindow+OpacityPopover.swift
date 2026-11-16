import AICore
import AppKit

extension CapturePinnedControlsBar {
  func syncOpacity(_ opacity: CGFloat) {
    opacityPopoverContent?.setOpacity(opacity)
    updateOpacitySelection()
  }

  func closePopoverIfNeeded() {
    if opacityPopover.isShown { opacityPopover.dismissPopover() }
    opacityPopoverContent = nil
    updateOpacitySelection()
  }

  func updateOpacitySelection() {
    let opacity = owner?.pinOpacity ?? 1
    opacityButton.isSelected = opacity < 0.999 || opacityPopover.isShown
  }

  @objc func handleOpacity() {
    if NSApp.currentEvent?.modifierFlags.contains(.option) == true {
      closePopoverIfNeeded()
      owner?.toggleTranslucentOpacity()
      return
    }
    if opacityPopover.isShown {
      opacityPopover.dismissPopover()
      return
    }
    let content = PinnedOpacityPopoverContent(opacity: owner?.pinOpacity ?? 1)
    content.onOpacityChange = { [weak self] value in
      self?.owner?.setPinOpacity(value, showHud: true)
    }
    opacityPopoverContent = content
    opacityPopover.onDidClose = { [weak self] in
      guard let self else { return }
      self.opacityPopoverContent = nil
      self.updateOpacitySelection()
      self.onKeepVisibleChanged?()
    }
    opacityPopover.show(
      contentView: content, contentSize: PinnedOpacityPopoverContent.preferredSize,
      relativeTo: opacityButton.bounds, of: opacityButton, preferredEdge: .minY)
    updateOpacitySelection()
    onKeepVisibleChanged?()
  }

  static func zoomIcon(zoomed: Bool, label: String) -> NSImage {
    templateIcon(label: label) {
      let lensCenter = NSPoint(x: 6.8, y: 9.2)
      let lensRadius: CGFloat = 4.3
      let path = NSBezierPath(
        ovalIn: NSRect(
          x: lensCenter.x - lensRadius, y: lensCenter.y - lensRadius,
          width: lensRadius * 2, height: lensRadius * 2))
      path.move(to: NSPoint(x: 9.9, y: 6.1))
      path.line(to: NSPoint(x: 13.5, y: 2.5))
      let barHalf: CGFloat = 1.8
      path.move(to: NSPoint(x: lensCenter.x - barHalf, y: lensCenter.y))
      path.line(to: NSPoint(x: lensCenter.x + barHalf, y: lensCenter.y))
      if !zoomed {
        path.move(to: NSPoint(x: lensCenter.x, y: lensCenter.y - barHalf))
        path.line(to: NSPoint(x: lensCenter.x, y: lensCenter.y + barHalf))
      }
      path.lineWidth = 1.35
      path.lineCapStyle = .round
      path.lineJoinStyle = .round
      NSColor.black.setStroke()
      path.stroke()
    }
  }
}

/// Compact `192 × 56 pt` opacity popover content with title, monospaced readout, and custom slider.
@MainActor
final class PinnedOpacityPopoverContent: NSView {
  static let preferredSize = NSSize(width: 192, height: 56)

  var onOpacityChange: ((CGFloat) -> Void)?

  private let titleLabel = NSTextField(labelWithString: "")
  private let percentLabel = NSTextField(labelWithString: "")
  private let slider: PinnedGlassSlider

  init(opacity: CGFloat) {
    slider = PinnedGlassSlider(
      minValue: CapturePinnedWindow.minOpacity, maxValue: 1.0, value: opacity)
    super.init(frame: NSRect(origin: .zero, size: Self.preferredSize))
    titleLabel.font = .systemFont(ofSize: 12, weight: .medium)
    titleLabel.textColor = .secondaryLabelColor
    titleLabel.lineBreakMode = .byTruncatingTail
    percentLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
    percentLabel.textColor = .labelColor
    percentLabel.alignment = .right
    slider.onChange = { [weak self] value in
      self?.updatePercentLabel(value)
      self?.onOpacityChange?(value)
    }
    for view in [titleLabel, percentLabel, slider] { addSubview(view) }
    applyStrings()
    setOpacity(opacity)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var intrinsicContentSize: NSSize { Self.preferredSize }
  override var fittingSize: NSSize { Self.preferredSize }

  override func layout() {
    super.layout()
    let inset: CGFloat = 12
    let contentWidth = max(40, bounds.width - inset * 2)
    titleLabel.frame = NSRect(x: inset, y: 10, width: max(20, contentWidth - 56), height: 16)
    percentLabel.frame = NSRect(x: inset + contentWidth - 54, y: 10, width: 54, height: 16)
    slider.frame = NSRect(x: inset, y: 30, width: contentWidth, height: 18)
  }

  func applyStrings() {
    let title = ShellStrings.shared.text(CaptureToolsStringKey.pinOpacity)
    titleLabel.stringValue = title
    slider.setAccessibilityLabel(title)
  }

  func setOpacity(_ opacity: CGFloat) {
    slider.value = opacity
    updatePercentLabel(opacity)
  }

  private func updatePercentLabel(_ opacity: CGFloat) {
    let text = "\(Int((opacity * 100).rounded()))%"
    if percentLabel.stringValue != text { percentLabel.stringValue = text }
  }
}

/// Custom-drawn continuous opacity slider (`10 pt` capsule track + `14 pt` white-rimmed thumb).
@MainActor
final class PinnedGlassSlider: NSView {
  private let minValue: CGFloat
  private let maxValue: CGFloat
  var value: CGFloat {
    didSet {
      let clamped = min(maxValue, max(minValue, value))
      if clamped != value {
        value = clamped
        return
      }
      if abs(value - oldValue) > 0.0001 { needsDisplay = true }
    }
  }
  var onChange: ((CGFloat) -> Void)?

  private var isTracking = false {
    didSet { if isTracking != oldValue { needsDisplay = true } }
  }
  private var isHovered = false {
    didSet { if isHovered != oldValue { needsDisplay = true } }
  }
  private var trackingArea: NSTrackingArea?
  private let srgb = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

  init(minValue: CGFloat, maxValue: CGFloat, value: CGFloat) {
    self.minValue = minValue
    self.maxValue = maxValue
    self.value = min(maxValue, max(minValue, value))
    super.init(frame: .zero)
    clipsToBounds = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() { addCursorRect(bounds, cursor: PointerRole.passive.cursor) }

  override func isAccessibilityElement() -> Bool { true }
  override func accessibilityRole() -> NSAccessibility.Role? { .slider }
  override func accessibilityMinValue() -> Any? { Int((minValue * 100).rounded()) }
  override func accessibilityMaxValue() -> Any? { Int((maxValue * 100).rounded()) }
  override func accessibilityValue() -> Any? { "\(Int((value * 100).rounded()))%" }

  override func accessibilityPerformIncrement() -> Bool {
    stepOpacity(by: 0.05)
    return true
  }

  override func accessibilityPerformDecrement() -> Bool {
    stepOpacity(by: -0.05)
    return true
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    needsDisplay = true
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) { isHovered = true }
  override func mouseExited(with event: NSEvent) { isHovered = false }

  override func mouseDown(with event: NSEvent) {
    CaptureTooltipPresenter.shared.dismiss()
    isTracking = true
    update(with: event)
  }

  override func mouseDragged(with event: NSEvent) {
    guard isTracking else { return }
    update(with: event)
  }

  override func mouseUp(with event: NSEvent) {
    guard isTracking else { return }
    update(with: event)
    isTracking = false
  }

  override func scrollWheel(with event: NSEvent) {
    CaptureTooltipPresenter.shared.dismiss()
    switch CaptureSliderWheel.step(for: event) {
    case .consumedNoOp:
      return
    case .delta(let unit):
      commitValue(value + CGFloat(unit) * (maxValue - minValue))
    }
  }

  private func update(with event: NSEvent) {
    let point = convert(event.locationInWindow, from: nil)
    let thumbInset: CGFloat = 7
    let span = max(1, bounds.width - thumbInset * 2)
    let progress = min(1, max(0, (point.x - thumbInset) / span))
    commitValue(minValue + (maxValue - minValue) * progress)
  }

  private func stepOpacity(by delta: CGFloat) {
    commitValue(value + delta)
  }

  private func commitValue(_ raw: CGFloat) {
    let next = min(maxValue, max(minValue, raw))
    guard abs(next - value) > 0.0005 else { return }
    value = next
    onChange?(next)
  }

  override func draw(_ dirtyRect: NSRect) {
    guard let context = NSGraphicsContext.current?.cgContext, bounds.width > 16 else { return }
    let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    let highContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
    let trackHeight: CGFloat = 10
    let thumbDiameter: CGFloat = 14
    let thumbInset = thumbDiameter / 2
    let trackRect = NSRect(
      x: 0, y: (bounds.height - trackHeight) / 2, width: bounds.width, height: trackHeight)
    let span = max(1, trackRect.width - thumbInset * 2)
    let progress = min(1, max(0, (value - minValue) / max(0.0001, maxValue - minValue)))
    let thumbCenterX = trackRect.minX + thumbInset + progress * span

    drawTrack(
      in: trackRect, radius: trackHeight / 2, fillEndX: thumbCenterX, dark: dark,
      highContrast: highContrast, context: context)
    drawThumb(
      at: CGPoint(x: thumbCenterX, y: trackRect.midY), diameter: thumbDiameter, dark: dark,
      highContrast: highContrast)
  }

  private func drawTrack(
    in trackRect: NSRect, radius: CGFloat, fillEndX: CGFloat, dark: Bool, highContrast: Bool,
    context: CGContext
  ) {
    let capsule = NSBezierPath(roundedRect: trackRect, xRadius: radius, yRadius: radius)
    NSColor.labelColor.withAlphaComponent(dark ? 0.14 : 0.10).setFill()
    capsule.fill()

    let accent = NSColor.controlAccentColor.usingColorSpace(.sRGB) ?? .controlAccentColor
    let startColor = accent.withAlphaComponent(isTracking || isHovered ? 0.48 : 0.38).cgColor
    let endColor = accent.withAlphaComponent(isTracking || isHovered ? 1.0 : 0.88).cgColor
    if let gradient = CGGradient(
      colorsSpace: srgb, colors: [startColor, endColor] as CFArray, locations: [0, 1])
    {
      context.saveGState()
      capsule.addClip()
      context.clip(
        to: CGRect(
          x: trackRect.minX, y: trackRect.minY, width: max(0, fillEndX - trackRect.minX),
          height: trackRect.height))
      context.drawLinearGradient(
        gradient, start: CGPoint(x: trackRect.minX, y: trackRect.midY),
        end: CGPoint(x: max(trackRect.minX + 1, fillEndX), y: trackRect.midY), options: [])
      context.restoreGState()
    }

    let rim = NSBezierPath(
      roundedRect: trackRect.insetBy(dx: 0.5, dy: 0.5), xRadius: max(0, radius - 0.5),
      yRadius: max(0, radius - 0.5))
    rim.lineWidth = 0.75
    NSColor.labelColor.withAlphaComponent(highContrast ? 0.40 : (dark ? 0.16 : 0.14)).setStroke()
    rim.stroke()
  }

  private func drawThumb(at center: CGPoint, diameter: CGFloat, dark: Bool, highContrast: Bool) {
    let rect = NSRect(
      x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(dark ? 0.44 : 0.28)
    shadow.shadowBlurRadius = isTracking ? 4 : 3
    shadow.shadowOffset = NSSize(width: 0, height: -1)
    shadow.set()
    NSColor.white.setFill()
    NSBezierPath(ovalIn: rect).fill()
    NSGraphicsContext.restoreGraphicsState()

    let inner = rect.insetBy(dx: 2.25, dy: 2.25)
    let tint = (NSColor.controlAccentColor.usingColorSpace(.sRGB) ?? .controlAccentColor)
      .withAlphaComponent(isTracking ? 0.92 : 0.78)
    tint.setFill()
    NSBezierPath(ovalIn: inner).fill()

    let outerRim = NSBezierPath(ovalIn: rect.insetBy(dx: 0.35, dy: 0.35))
    outerRim.lineWidth = 0.7
    NSColor.black.withAlphaComponent(highContrast ? 0.45 : (dark ? 0.22 : 0.26)).setStroke()
    outerRim.stroke()
  }
}
