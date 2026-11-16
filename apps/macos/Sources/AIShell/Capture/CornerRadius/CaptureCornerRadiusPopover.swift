import AICore
import AppKit

/// Compact `236 × 94 pt` corner-radius popover with preset chips and a continuous slider.
@MainActor
final class CaptureCornerRadiusPopover: NSViewController {
  static let popoverSize = NSSize(width: 236, height: 94)
  static let presets: [CGFloat] = [0, 8, 12, 16, 24, 32]

  var maxRadius: CGFloat = 48 {
    didSet {
      let clamped = max(1, maxRadius)
      if clamped != maxRadius {
        maxRadius = clamped
        return
      }
      slider.maxValue = Double(clamped)
      currentRadius = min(max(0, currentRadius), clamped)
      syncDisplayedState()
    }
  }

  var currentRadius: CGFloat = 0 {
    didSet {
      let clamped = Self.normalizedRadius(currentRadius, maxRadius: maxRadius)
      if clamped != currentRadius {
        currentRadius = clamped
        return
      }
      syncDisplayedState()
    }
  }

  /// Continuous slider drags/scrolls pass a non-nil `burst` UUID; preset chip clicks pass `nil`.
  var onChange: ((CGFloat, UUID?) -> Void)?
  var onBurstEnd: (() -> Void)?
  var onClose: (() -> Void)?
  var isShown: Bool { panel.isShown }
  var isDraggingSlider: Bool { slider.isDragging }
  var isWheelBurstActive: Bool { slider.isWheelBurstActive }

  private let panel = CapturePopoverPanel()
  private let titleLabel = NSTextField(labelWithString: "")
  private let readoutLabel = NSTextField(labelWithString: "")
  private let slider = CornerRadiusSlider()
  private var chips: [CornerPresetChipButton] = []

  override init(nibName nibNameOrNil: NSNib.Name?, bundle nibBundleOrNil: Bundle?) {
    super.init(nibName: nibNameOrNil, bundle: nibBundleOrNil)
    preferredContentSize = Self.popoverSize
    panel.onDidClose = { [weak self] in
      self?.slider.resetWheelBurst()
      self?.onBurstEnd?()
      self?.onClose?()
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func loadView() {
    let root = CaptureFlippedPopoverView(frame: NSRect(origin: .zero, size: Self.popoverSize))
    root.onAppearanceChange = { [weak self] in self?.refreshChipAppearance() }
    view = root
    buildHierarchy(in: root)
    applyStrings()
  }

  func show(
    relativeTo positioningRect: NSRect, of positioningView: NSView,
    preferredEdge: NSRectEdge = .minY
  ) {
    _ = view
    applyStrings()
    panel.show(
      contentView: view, contentSize: Self.popoverSize,
      relativeTo: positioningRect, of: positioningView, preferredEdge: preferredEdge)
    refreshChipAppearance()
  }

  func dismissPopover() { panel.dismissPopover() }

  private func buildHierarchy(in root: NSView) {
    let inset: CGFloat = 12
    let contentWidth = Self.popoverSize.width - inset * 2
    titleLabel.font = .systemFont(ofSize: 12, weight: .medium)
    titleLabel.textColor = .secondaryLabelColor
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.frame = NSRect(x: inset, y: 12, width: contentWidth - 68, height: 16)
    readoutLabel.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
    readoutLabel.textColor = .labelColor
    readoutLabel.alignment = .right
    readoutLabel.frame = NSRect(x: inset + contentWidth - 68, y: 12, width: 68, height: 16)
    root.addSubview(titleLabel)
    root.addSubview(readoutLabel)

    let gap: CGFloat = 4
    let count = CGFloat(Self.presets.count)
    let chipWidth = (contentWidth - gap * (count - 1)) / count
    chips = Self.presets.enumerated().map { index, value in
      let chip = CornerPresetChipButton(
        value: value, target: self, action: #selector(chipClicked(_:)))
      chip.frame = NSRect(
        x: inset + CGFloat(index) * (chipWidth + gap), y: 34, width: chipWidth, height: 28)
      root.addSubview(chip)
      return chip
    }

    slider.minValue = 0
    slider.maxValue = Double(maxRadius)
    slider.controlSize = .small
    slider.isContinuous = true
    slider.refusesFirstResponder = true
    slider.target = self
    slider.action = #selector(sliderChanged)
    slider.onWheelDelta = { [weak self] raw, burst in
      self?.applySliderValue(raw, burst: burst)
    }
    slider.onWheelSettled = { [weak self] in
      self?.syncDisplayedState()
      self?.onBurstEnd?()
    }
    slider.onDragEnd = { [weak self] in self?.onBurstEnd?() }
    slider.frame = NSRect(x: inset, y: 66, width: contentWidth, height: 16)
    root.addSubview(slider)
  }

  private func applyStrings() {
    let strings = ShellStrings.shared
    titleLabel.stringValue = strings.text(CaptureToolsStringKey.cornerRadius)
    slider.setAccessibilityLabel(titleLabel.stringValue)
    for chip in chips {
      chip.setAccessibilityLabel(Self.formattedValue(chip.presetValue, strings: strings))
    }
    syncDisplayedState()
  }

  private func syncDisplayedState() {
    guard isViewLoaded else { return }
    let formatted = Self.formattedValue(currentRadius)
    if readoutLabel.stringValue != formatted {
      readoutLabel.stringValue = formatted
    }
    if !slider.isDragging, abs(slider.doubleValue - Double(currentRadius)) > 0.0001 {
      slider.doubleValue = Double(currentRadius)
    }
    var chipChanged = false
    for chip in chips {
      let active = abs(currentRadius - chip.presetValue) < 0.5
      if chip.isActive != active {
        chip.isActive = active
        chipChanged = true
      }
    }
    if chipChanged { refreshChipAppearance() }
  }

  private func refreshChipAppearance() {
    guard isViewLoaded else { return }
    view.effectiveAppearance.performAsCurrentDrawingAppearance {
      for chip in chips { chip.updateAppearance() }
    }
  }

  @objc private func chipClicked(_ sender: CornerPresetChipButton) {
    slider.resetWheelBurst()
    currentRadius = sender.presetValue
    slider.doubleValue = Double(currentRadius)
    onChange?(currentRadius, nil)
  }

  @objc private func sliderChanged() {
    applySliderValue(CGFloat(slider.doubleValue), burst: slider.activeBurst)
  }

  private func applySliderValue(_ raw: CGFloat, burst: UUID?) {
    let next = Self.normalizedRadius(raw, maxRadius: maxRadius)
    guard abs(next - currentRadius) > 0.01 else { return }
    currentRadius = next
    onChange?(next, burst)
  }

  private static func normalizedRadius(_ raw: CGFloat, maxRadius: CGFloat) -> CGFloat {
    guard raw.isFinite else { return 0 }
    return raw < 0.25 ? 0 : min(max(0, (raw * 100).rounded() / 100), maxRadius)
  }

  private static func formattedValue(_ radius: CGFloat, strings: ShellStrings = .shared) -> String {
    let rounded = Int(radius.rounded())
    return rounded == 0
      ? strings.text(CaptureToolsStringKey.cornerSharpBadge)
      : strings.text(CaptureToolsStringKey.cornerRadiusShort, count: rounded)
  }
}

private final class CornerPresetChipButton: NSButton {
  let presetValue: CGFloat
  var isActive = false { didSet { if isActive != oldValue { updateAppearance() } } }
  override var isHighlighted: Bool {
    didSet { if isHighlighted != oldValue { updateAppearance() } }
  }
  private var isHovered = false { didSet { if isHovered != oldValue { updateAppearance() } } }
  private var hoverArea: NSTrackingArea?

  init(value: CGFloat, target: AnyObject, action: Selector) {
    self.presetValue = value
    super.init(frame: .zero)
    isBordered = false
    bezelStyle = .regularSquare
    font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
    refusesFirstResponder = true
    wantsLayer = true
    layer?.cornerRadius = 8
    layer?.cornerCurve = .continuous
    layer?.borderWidth = 1
    self.target = target
    self.action = action
    updateAppearance()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() { addCursorRect(bounds, cursor: PointerRole.action.cursor) }
  override func mouseEntered(with event: NSEvent) { isHovered = true }
  override func mouseExited(with event: NSEvent) { isHovered = false }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let hoverArea { removeTrackingArea(hoverArea) }
    let area = NSTrackingArea(
      rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self, userInfo: nil)
    addTrackingArea(area)
    hoverArea = area
  }

  func updateAppearance() {
    let textColor: NSColor = isActive ? .controlAccentColor : .labelColor
    let fillColor: NSColor =
      isActive
      ? .controlAccentColor.withAlphaComponent(isHighlighted ? 0.28 : 0.2)
      : .labelColor.withAlphaComponent(isHighlighted ? 0.14 : isHovered ? 0.09 : 0.04)
    let borderColor: NSColor =
      isActive ? .controlAccentColor : .separatorColor.withAlphaComponent(0.35)
    layer?.backgroundColor = fillColor.cgColor
    layer?.borderColor = borderColor.cgColor
    attributedTitle = NSAttributedString(
      string: "\(Int(presetValue))",
      attributes: [
        .font: font ?? .monospacedDigitSystemFont(ofSize: 12, weight: .medium),
        .foregroundColor: textColor,
      ])
  }
}

private final class CornerRadiusSlider: NSSlider {
  private let wheelBurst = CaptureWheelBurst()
  private(set) var activeBurst: UUID?
  private(set) var isDragging = false
  private(set) var isWheelBurstActive = false
  var onWheelDelta: ((CGFloat, UUID) -> Void)?
  var onWheelSettled: (() -> Void)?
  var onDragEnd: (() -> Void)?

  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() { addCursorRect(bounds, cursor: PointerRole.passive.cursor) }

  override func mouseDown(with event: NSEvent) {
    CaptureTooltipPresenter.shared.dismiss()
    resetWheelBurst()
    activeBurst = UUID()
    isDragging = true
    super.mouseDown(with: event)
    isDragging = false
    activeBurst = nil
    onDragEnd?()
  }

  override func scrollWheel(with event: NSEvent) {
    CaptureTooltipPresenter.shared.dismiss()
    switch CaptureSliderWheel.step(for: event) {
    case .consumedNoOp:
      return
    case .delta(let unit):
      let next = min(max(minValue, doubleValue + unit * (maxValue - minValue)), maxValue)
      guard abs(next - doubleValue) > 0.0001 else { return }
      isWheelBurstActive = true
      let burst = wheelBurst.next(for: event) { [weak self] in
        guard let self else { return }
        self.isWheelBurstActive = false
        self.onWheelSettled?()
      }
      doubleValue = next
      onWheelDelta?(CGFloat(next), burst)
    }
  }

  func resetWheelBurst() {
    isWheelBurstActive = false
    wheelBurst.reset()
  }
}
