import AppKit
import QuartzCore

/// Non-focus-stealing capsule tab bar with a sliding elevated indicator pill, hover feedback,
/// Reduce Motion cross-fade support, and Increase Contrast border support.
@MainActor
final class CaptureFontTabBar: NSView {
  var onSelectSegment: ((Int) -> Void)?

  private(set) var selectedSegment = 0
  private var segmentViews: [SegmentTabItemView] = []
  private let hoverView = CaptureFontTabBar.makeLayerView(cornerRadius: 6)
  private let indicatorView = CaptureFontTabBar.makeLayerView(cornerRadius: 6)
  private var hoveredIndex: Int?
  private var pressedIndex: Int?
  private var trackingArea: NSTrackingArea?
  private var displayObserver: NSObjectProtocol?
  private var lastLayoutSize: NSSize = .zero
  private var isAnimatingIndicator = false
  private var animationGeneration = 0
  private var isDark: Bool { effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua }

  init(segmentCount: Int) {
    super.init(frame: .zero)
    wantsLayer = true
    layer?.cornerRadius = 8
    layer?.cornerCurve = .continuous
    hoverView.isHidden = true
    addSubview(hoverView)
    addSubview(indicatorView)

    segmentViews = (0..<max(1, segmentCount)).map { index in
      let item = SegmentTabItemView()
      item.onAccessibilityPress = { [weak self] in
        self?.activateSegment(index)
        return true
      }
      addSubview(item)
      return item
    }
    setAccessibilityElement(false)
    setAccessibilityRole(.radioGroup)
    updateAppearance()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  isolated deinit { removeDisplayObserver() }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() { addCursorRect(bounds, cursor: PointerRole.action.cursor) }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateAppearance()
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    super.viewWillMove(toWindow: newWindow)
    removeDisplayObserver()
    if newWindow == nil {
      hoveredIndex = nil
      pressedIndex = nil
    }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil, displayObserver == nil {
      displayObserver = NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
        queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.updateAppearance() } }
    }
    syncHoverFromPointer()
    updateAppearance()
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
      owner: self)
    addTrackingArea(area)
    trackingArea = area
    syncHoverFromPointer()
    refreshSegmentStates()
  }

  override func layout() {
    super.layout()
    for (index, item) in segmentViews.enumerated() { item.frame = segmentFrame(at: index) }
    if bounds.size != lastLayoutSize || !isAnimatingIndicator {
      snapIndicator(to: selectedSegment)
    }
    lastLayoutSize = bounds.size
    refreshSegmentStates()
  }

  func setLabel(_ title: String, forSegment index: Int) {
    guard segmentViews.indices.contains(index) else { return }
    segmentViews[index].setTitle(title)
  }

  func setSelectedSegment(_ index: Int, animated: Bool) {
    guard segmentViews.indices.contains(index) else { return }
    let changed = selectedSegment != index
    selectedSegment = index
    refreshSegmentStates()

    let targetFrame = segmentFrame(at: index)
    animationGeneration += 1
    let generation = animationGeneration
    guard changed, animated, window != nil, bounds.width > 0 else {
      isAnimatingIndicator = false
      snapIndicator(to: index)
      return
    }
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      isAnimatingIndicator = false
      snapIndicator(to: index)
      indicatorView.alphaValue = 0.45
      NSAnimationContext.runAnimationGroup {
        $0.duration = 0.16
        $0.timingFunction = CAMediaTimingFunction(name: .easeOut)
        indicatorView.animator().alphaValue = 1
      }
      return
    }
    isAnimatingIndicator = true
    NSAnimationContext.runAnimationGroup(
      {
        $0.duration = 0.22
        $0.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1, 0.36, 1)
        indicatorView.animator().frame = targetFrame
      },
      completionHandler: {
        Task { @MainActor [weak self] in self?.finishIndicatorAnimation(generation) }
      })
  }

  override func mouseEntered(with event: NSEvent) { updateHoveredSegment(for: event) }
  override func mouseMoved(with event: NSEvent) { updateHoveredSegment(for: event) }

  override func mouseExited(with event: NSEvent) {
    hoveredIndex = nil
    refreshSegmentStates()
  }

  override func mouseDown(with event: NSEvent) {
    pressedIndex = segmentIndex(at: convert(event.locationInWindow, from: nil))
    hoveredIndex = pressedIndex
    refreshSegmentStates()
  }

  override func mouseDragged(with event: NSEvent) {
    guard pressedIndex != nil else { return }
    hoveredIndex = segmentIndex(at: convert(event.locationInWindow, from: nil))
    refreshSegmentStates()
  }

  override func mouseUp(with event: NSEvent) {
    guard let pressed = pressedIndex else { return }
    pressedIndex = nil
    let released = segmentIndex(at: convert(event.locationInWindow, from: nil))
    hoveredIndex = released
    if released == pressed { activateSegment(pressed) } else { refreshSegmentStates() }
  }

  private func removeDisplayObserver() {
    if let displayObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(displayObserver)
      self.displayObserver = nil
    }
  }

  private func activateSegment(_ index: Int) {
    let changed = selectedSegment != index
    setSelectedSegment(index, animated: true)
    if changed { onSelectSegment?(index) }
  }

  private func finishIndicatorAnimation(_ generation: Int) {
    guard generation == animationGeneration else { return }
    isAnimatingIndicator = false
    snapIndicator(to: selectedSegment)
  }

  private func snapIndicator(to index: Int) {
    indicatorView.frame = segmentFrame(at: index)
    let b = indicatorView.bounds
    indicatorView.layer?.shadowPath =
      b.width > 0 && b.height > 0
      ? CGPath(roundedRect: b, cornerWidth: 6, cornerHeight: 6, transform: nil) : nil
  }

  private func segmentFrame(at index: Int) -> NSRect {
    let inset: CGFloat = 2
    let segmentWidth = max(0, bounds.width - inset * 2) / CGFloat(max(1, segmentViews.count))
    return NSRect(
      x: inset + CGFloat(index) * segmentWidth, y: inset, width: segmentWidth,
      height: max(0, bounds.height - inset * 2))
  }

  private func segmentIndex(at point: NSPoint) -> Int? {
    guard bounds.contains(point), bounds.width > 0, !segmentViews.isEmpty else { return nil }
    let raw = Int(floor(point.x / (bounds.width / CGFloat(segmentViews.count))))
    return max(0, min(segmentViews.count - 1, raw))
  }

  private func updateHoveredSegment(for event: NSEvent) {
    let next = segmentIndex(at: convert(event.locationInWindow, from: nil))
    guard hoveredIndex != next else { return }
    hoveredIndex = next
    refreshSegmentStates()
  }

  private func syncHoverFromPointer() {
    guard let window, window.isVisible else {
      hoveredIndex = nil
      return
    }
    hoveredIndex = segmentIndex(
      at: convert(window.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil))
  }

  private func updateAppearance() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let dark = isDark
      let highContrast = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast

      layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(dark ? 0.07 : 0.05).cgColor
      layer?.borderWidth = highContrast ? 1 : 0
      layer?.borderColor = highContrast ? NSColor.separatorColor.cgColor : nil

      let pillFill: NSColor =
        dark
        ? .white.withAlphaComponent(highContrast ? 0.22 : 0.14) : .white.withAlphaComponent(0.95)
      let pillRim: NSColor =
        dark
        ? .white.withAlphaComponent(highContrast ? 0.24 : 0.08)
        : .black.withAlphaComponent(highContrast ? 0.20 : 0.06)
      indicatorView.layer?.backgroundColor = pillFill.cgColor
      indicatorView.layer?.borderWidth = highContrast ? 1 : 0.5
      indicatorView.layer?.borderColor = pillRim.cgColor
      indicatorView.layer?.shadowColor = NSColor.black.cgColor
      indicatorView.layer?.shadowOpacity = dark ? 0 : 0.08
      indicatorView.layer?.shadowRadius = dark ? 0 : 2
      indicatorView.layer?.shadowOffset = dark ? .zero : CGSize(width: 0, height: -1)
      applySegmentStates(dark: dark)
    }
  }

  private func refreshSegmentStates() {
    effectiveAppearance.performAsCurrentDrawingAppearance { applySegmentStates(dark: isDark) }
  }

  private func applySegmentStates(dark: Bool) {
    let activeHover: Int? = pressedIndex.map { hoveredIndex == $0 ? $0 : nil } ?? hoveredIndex
    if let idx = activeHover, idx != selectedSegment {
      hoverView.isHidden = false
      hoverView.frame = segmentFrame(at: idx)
      let pressedInside = pressedIndex == idx && hoveredIndex == idx
      let alpha: CGFloat = pressedInside ? (dark ? 0.12 : 0.09) : (dark ? 0.07 : 0.05)
      hoverView.layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(alpha).cgColor
    } else {
      hoverView.isHidden = true
    }

    for (idx, item) in segmentViews.enumerated() {
      let isSelected = idx == selectedSegment
      let isEmphasized =
        isSelected || (hoveredIndex == idx && (pressedIndex == nil || pressedIndex == idx))
      item.update(selected: isSelected, emphasized: isEmphasized)
    }
  }

  private static func makeLayerView(cornerRadius: CGFloat) -> NSView {
    let view = NSView()
    view.wantsLayer = true
    view.layer?.cornerRadius = cornerRadius
    view.layer?.cornerCurve = .continuous
    return view
  }
}

@MainActor
private final class SegmentTabItemView: NSView {
  var onAccessibilityPress: (() -> Bool)?
  private let label = NSTextField(labelWithString: "")
  private var isSelected = false

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    label.alignment = .center
    label.lineBreakMode = .byTruncatingTail
    label.maximumNumberOfLines = 1
    label.usesSingleLineMode = true
    label.font = .systemFont(ofSize: 12, weight: .medium)
    label.textColor = .secondaryLabelColor
    label.setAccessibilityElement(false)
    addSubview(label)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { false }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func isAccessibilityElement() -> Bool { true }
  override func accessibilityRole() -> NSAccessibility.Role? { .radioButton }
  override func accessibilityLabel() -> String? { label.stringValue }
  override func accessibilityValue() -> Any? { NSNumber(value: isSelected) }
  override func accessibilityPerformPress() -> Bool { onAccessibilityPress?() ?? false }

  override func layout() {
    super.layout()
    let font = label.font ?? .systemFont(ofSize: 12, weight: .medium)
    let height = ceil(font.ascender - font.descender + font.leading)
    label.frame = NSRect(
      x: 4, y: floor((bounds.height - height) * 0.5), width: max(0, bounds.width - 8),
      height: height)
  }

  func setTitle(_ title: String) {
    if label.stringValue != title { label.stringValue = title }
  }

  func update(selected: Bool, emphasized: Bool) {
    isSelected = selected
    label.font = .systemFont(ofSize: 12, weight: selected ? .semibold : .medium)
    label.textColor = emphasized ? .labelColor : .secondaryLabelColor
  }
}
