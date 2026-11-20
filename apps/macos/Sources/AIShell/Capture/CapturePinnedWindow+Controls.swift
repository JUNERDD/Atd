import AICore
import AppKit

extension PinnedContentView {
  func layoutControlsAndHud() {
    controlsBar.setMode(hideZoom: bounds.width < 216, size: bounds.size)
    placeCentered(controlsBar, top: 8)
    placeCentered(hudBar, top: nil)
  }

  private func placeCentered(_ view: NSView, top: CGFloat?) {
    view.layoutSubtreeIfNeeded()
    let s = view.fittingSize
    let inset = min(top ?? 12, max(top != nil ? 2 : 4, (bounds.height - s.height) / 2))
    let y = top != nil ? bounds.height - s.height - inset : inset
    view.frame = NSRect(
      x: round((bounds.width - s.width) / 2), y: round(y), width: s.width, height: s.height)
  }

  func refreshHoverVisibility() {
    if !isHovered, !controlsBar.keepsVisible, let window,
      CaptureCursorOwnership.ownsPointer(in: window, at: NSEvent.mouseLocation)
    {
      isHovered = bounds.contains(convert(window.mouseLocationOutsideOfEventStream, from: nil))
    }
    let v = isHovered || isDragging || controlsBar.keepsVisible
    let d = abs(controlsBar.alphaValue - (v ? 1 : 0))
    guard controlsBar.isHidden == v || d > 0.01 else { return }
    setView(controlsBar, visible: v, duration: v ? 0.12 : 0.16)
  }

  func showHud(_ text: String) {
    if hudLabel.stringValue != text {
      hudLabel.stringValue = text
      hudLabel.invalidateIntrinsicContentSize()
      placeCentered(hudBar, top: nil)
    }
    if hudBar.isHidden || hudBar.alphaValue < 0.99 {
      setView(hudBar, visible: true, duration: 0.12)
    }
    hudTask?.cancel()
    hudTask = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(900))
      guard !Task.isCancelled, let self else { return }
      self.setView(self.hudBar, visible: false, duration: 0.22)
    }
  }

  private func setView(_ view: NSView, visible: Bool, duration: TimeInterval) {
    if visible { view.isHidden = false }
    let target: CGFloat = visible ? 1 : 0
    if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
      (view.alphaValue, view.isHidden) = (target, !visible)
    } else {
      NSAnimationContext.runAnimationGroup {
        ($0.duration, $0.timingFunction) = (duration, .init(name: .easeOut))
        view.animator().alphaValue = target
      } completionHandler: { [weak view] in
        Task { @MainActor in if let view, view.alphaValue <= 0.01 { view.isHidden = true } }
      }
    }
  }

  func buildContextMenu() -> NSMenu {
    let s: (CaptureToolsStringKey) -> String = ShellStrings.shared.text
    let menu = NSMenu()
    let curOpacity = Int(((pinnedWindow?.pinOpacity ?? 1) * 100).rounded())
    let curScale = Int(((pinnedWindow?.pinScale ?? 1) * 100).rounded())
    func add(
      _ t: String, _ sel: Selector, _ target: AnyObject?, _ key: String = "",
      _ on: Bool = false, _ tag: Int = 0
    ) {
      let item = menu.addItem(withTitle: t, action: sel, keyEquivalent: key)
      (item.target, item.tag, item.state) = (target, tag, on ? .on : .off)
    }
    add(s(.pinCopyImage), #selector(CapturePinnedWindow.performCopy), pinnedWindow, "c")
    menu.addItem(.separator())
    menu.addItem(.sectionHeader(title: s(.pinZoomAccessibility)))
    for pct in [100, 150, 200] {
      add("\(pct)%", #selector(menuZoom), self, "", curScale == pct, pct)
    }
    menu.addItem(.separator())
    add(
      s(.pinBorder), #selector(CapturePinnedWindow.toggleBorder), pinnedWindow, "",
      pinnedWindow?.isBorderEnabled == true)
    add(
      s(.pinShadow), #selector(CapturePinnedWindow.toggleShadow), pinnedWindow, "",
      pinnedWindow?.isShadowEnabled == true)
    menu.addItem(.separator())
    menu.addItem(.sectionHeader(title: s(.pinOpacity)))
    for pct in [100, 80, 60, 40, 25] {
      add("\(pct)%", #selector(menuOpacity), self, "", curOpacity == pct, pct)
    }
    menu.addItem(.separator())
    add(s(.pinCloseTooltip), #selector(CapturePinnedWindow.closePin), pinnedWindow)
    return menu
  }

  @objc private func menuZoom(_ sender: NSMenuItem) {
    pinnedWindow?.setPinScale(CGFloat(sender.tag) / 100, showHud: true)
  }

  @objc private func menuOpacity(_ sender: NSMenuItem) {
    pinnedWindow?.setPinOpacity(CGFloat(sender.tag) / 100, showHud: true)
  }
}

final class CapturePinnedControlsBar: NSView {
  private typealias Btn = AnnotationToolbarButton
  weak var owner: CapturePinnedWindow? {
    didSet {
      for b in [borderButton, shadowButton, zoomButton, copyButton, closeButton] {
        b.target = owner
      }
      syncAll()
    }
  }
  var onKeepVisibleChanged: (() -> Void)?
  private let scaleHost = NSView()
  let opacityButton: AnnotationToolbarButton
  private let borderButton: AnnotationToolbarButton
  private let shadowButton: AnnotationToolbarButton
  private let zoomButton: AnnotationToolbarButton
  private let copyButton: AnnotationToolbarButton
  private let closeButton: AnnotationToolbarButton
  private let bar: AnnotationGlassBar
  let opacityPopover = CapturePopoverPanel()
  var opacityPopoverContent: PinnedOpacityPopoverContent?
  private var fittedSize = NSSize(width: 208, height: 40)
  var keepsVisible: Bool { opacityPopover.isShown }
  var actionButtons: [AnnotationToolbarButton] {
    [opacityButton, borderButton, shadowButton, zoomButton, copyButton, closeButton]
  }

  init() {
    opacityButton = Btn(selection: .washToggle, action: #selector(handleOpacity))
    borderButton = Btn(selection: .washToggle, action: #selector(CapturePinnedWindow.toggleBorder))
    shadowButton = Btn(selection: .washToggle, action: #selector(CapturePinnedWindow.toggleShadow))
    zoomButton = Btn(selection: .washToggle, action: #selector(CapturePinnedWindow.toggleZoom))
    copyButton = Btn(selection: nil, action: #selector(CapturePinnedWindow.performCopy))
    closeButton = Btn(selection: nil, action: #selector(CapturePinnedWindow.closePin))
    bar = AnnotationGlassBar(
      groups: [
        [opacityButton, borderButton, shadowButton],
        [zoomButton],
        [copyButton, closeButton],
      ],
      blending: .behindWindow, padding: 6, dividerSpacing: (5, 5))
    super.init(frame: NSRect(origin: .zero, size: fittedSize))
    opacityButton.target = self
    for b in actionButtons { b.followsPointer = false }
    scaleHost.addSubview(bar)
    addSubview(scaleHost)
    setAccessibilityElement(true)
    setAccessibilityRole(.toolbar)
    applyStrings()
  }

  @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
  override var fittingSize: NSSize { fittedSize }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func hitTest(_ p: NSPoint) -> NSView? {
    isHidden || alphaValue < 0.05 ? nil : super.hitTest(p)
  }

  override func layout() {
    super.layout()
    let natRect = NSRect(origin: .zero, size: bar.fittingSize)
    bar.frame = natRect
    bar.layoutSubtreeIfNeeded()
    (scaleHost.frame, scaleHost.bounds) = (bounds, bounds.isEmpty ? .zero : natRect)
  }

  func setMode(hideZoom: Bool, size: CGSize) {
    bar.setGroup(1, hidden: hideZoom)
    let nat = bar.fittingSize
    let wScale = max(24, size.width - 16) / max(1, nat.width)
    let hScale = max(16, size.height - 12) / max(1, nat.height)
    let s = min(1, min(wScale, hScale))
    fittedSize = NSSize(width: round(nat.width * s), height: round(nat.height * s))
    needsLayout = true
  }

  func applyStrings() {
    let s: (CaptureToolsStringKey) -> String = ShellStrings.shared.text
    setBtn(
      opacityButton, s(.pinOpacity), .pinOpacity, AnnotationIcons.fillSoft,
      "circle.lefthalf.filled")
    setBtn(borderButton, s(.pinBorderTooltip), .pinBorder, customImage: Self.borderIcon)
    setBtn(shadowButton, s(.pinShadowTooltip), .pinShadow, customImage: Self.shadowIcon)
    let copyTip = String(
      format: ShellStrings.shared.text(ShellStringKey.captureTooltipShortcut), s(.pinCopyImage),
      "⌘C")
    setBtn(copyButton, copyTip, .pinCopyAccessibility, AnnotationIcons.copy, "doc.on.doc")
    setBtn(
      closeButton, s(.pinCloseTooltip), .pinCloseAccessibility, AnnotationIcons.cancel, "xmark")
    syncAll()
    opacityPopoverContent?.applyStrings()
  }

  func syncBorder(_ enabled: Bool) { borderButton.isSelected = enabled }
  func syncShadow(_ enabled: Bool) { shadowButton.isSelected = enabled }

  func syncZoom(_ scale: CGFloat) {
    let zoomed = abs(scale - 1.0) > 0.005
    zoomButton.isSelected = zoomed
    setBtn(
      zoomButton, ShellStrings.shared.text(CaptureToolsStringKey.pinZoomTooltip),
      .pinZoomAccessibility, customImage: { Self.zoomIcon(zoomed: zoomed, label: $0) })
  }

  private func syncAll() {
    syncOpacity(owner?.pinOpacity ?? 1)
    syncBorder(owner?.isBorderEnabled ?? true)
    syncShadow(owner?.isShadowEnabled ?? true)
    syncZoom(owner?.pinScale ?? 1)
  }

  private func setBtn(
    _ button: AnnotationToolbarButton, _ tip: String?,
    _ label: CaptureToolsStringKey, _ lucide: String? = nil, _ fallback: String? = nil,
    customImage: ((String) -> NSImage)? = nil
  ) {
    let text = ShellStrings.shared.text(label)
    button.toolTip = tip
    button.setAccessibilityLabel(text)
    if let customImage {
      button.image = customImage(text)
      return
    }
    let img = lucide.flatMap { NSImage(named: "lucide-\($0)")?.copy() as? NSImage }
    if let img {
      (img.size, img.isTemplate) = (NSSize(width: 16, height: 16), true)
      img.accessibilityDescription = text
    }
    button.image = img ?? fallback.flatMap { AnnotationIcons.symbol($0, label: text) }
  }

  static func templateIcon(label: String, draw: @Sendable @escaping () -> Void) -> NSImage {
    let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { _ in
      draw()
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = label
    return image
  }

  private static func borderIcon(label: String) -> NSImage {
    templateIcon(label: label) {
      let outer = NSBezierPath(
        roundedRect: NSRect(x: 2.25, y: 2.25, width: 11.5, height: 11.5), xRadius: 2.8, yRadius: 2.8
      )
      outer.lineWidth = 1.35
      NSColor.black.setStroke()
      outer.stroke()
      NSColor.black.withAlphaComponent(0.28).setFill()
      NSBezierPath(
        roundedRect: NSRect(x: 4.5, y: 4.5, width: 7, height: 7), xRadius: 1.2, yRadius: 1.2
      ).fill()
    }
  }

  private static func shadowIcon(label: String) -> NSImage {
    templateIcon(label: label) {
      let frontPath = NSBezierPath(
        roundedRect: NSRect(x: 2.0, y: 4.2, width: 9.6, height: 9.6), xRadius: 2.3, yRadius: 2.3)
      let shadowRect = NSRect(x: 4.4, y: 1.8, width: 9.6, height: 9.6)
      let shadowPath = NSBezierPath(roundedRect: shadowRect, xRadius: 2.3, yRadius: 2.3)
      NSGraphicsContext.saveGraphicsState()
      shadowPath.addClip()
      NSColor.black.withAlphaComponent(0.45).setFill()
      shadowRect.fill()
      NSGraphicsContext.current?.cgContext.setBlendMode(.clear)
      frontPath.fill()
      NSGraphicsContext.restoreGraphicsState()
      frontPath.lineWidth = 1.35
      NSColor.black.setStroke()
      frontPath.stroke()
    }
  }
}

/// Non-interactive dual-contrast 1pt hairline drawn above the pinned image so edges stay visible
/// against both bright and dark windows.
final class PinnedBorderOverlayView: NSView {
  private let outerLayer = CALayer()
  private let innerLayer = CALayer()
  private static let noAnimation: [String: CAAction] = [
    "bounds": NSNull(), "position": NSNull(), "frame": NSNull(),
    "cornerRadius": NSNull(), "borderColor": NSNull(),
  ]

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.actions = Self.noAnimation
    for sublayer in [outerLayer, innerLayer] {
      sublayer.cornerCurve = .continuous
      sublayer.borderWidth = 1
      sublayer.actions = Self.noAnimation
      layer?.addSublayer(sublayer)
    }
    updateColors()
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(updateColors),
      name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
  }

  @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
  isolated deinit { NSWorkspace.shared.notificationCenter.removeObserver(self) }
  override func isAccessibilityElement() -> Bool { false }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    let scale = window?.backingScaleFactor ?? 2
    outerLayer.contentsScale = scale
    innerLayer.contentsScale = scale
  }

  override func layout() {
    super.layout()
    let outerRadius = min(8, min(bounds.width, bounds.height) / 2)
    outerLayer.frame = bounds
    outerLayer.cornerRadius = outerRadius
    let innerBounds = bounds.insetBy(dx: 1, dy: 1)
    innerLayer.isHidden = innerBounds.width <= 2 || innerBounds.height <= 2
    if !innerLayer.isHidden {
      innerLayer.frame = innerBounds
      innerLayer.cornerRadius = max(0, outerRadius - 1)
    }
  }

  @objc private func updateColors() {
    let hc = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
    outerLayer.borderColor = NSColor.black.withAlphaComponent(hc ? 0.42 : 0.22).cgColor
    innerLayer.borderColor = NSColor.white.withAlphaComponent(hc ? 0.50 : 0.28).cgColor
  }
}
