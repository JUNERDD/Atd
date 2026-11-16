import AICore
import AppKit

/// Floating non-activating always-on-top borderless panel displaying a pinned screenshot cutout.
@MainActor
final class CapturePinnedWindow: ActiveGlassPanel {
  static let minOpacity: CGFloat = 0.25
  static let minScale: CGFloat = 0.25
  static let maxScale: CGFloat = 4.0
  private static let minWindowEdge: CGFloat = 48
  private static let borderEnabledKey = "capture.pin.borderEnabled"
  private static let shadowEnabledKey = "capture.pin.shadowEnabled"

  private let logicalSize: CGSize
  private let defaults: UserDefaults
  private(set) var hasClosed = false
  var shadowInvalidationPending = false
  private var lastTranslucentOpacity: CGFloat = 0.5
  private(set) var pinScale: CGFloat = 1.0
  private(set) var pinOpacity: CGFloat = 1.0
  private(set) var isBorderEnabled: Bool
  private(set) var isShadowEnabled: Bool
  private let onCopyAction: () -> Bool
  private let onCloseAction: (CapturePinnedWindow) -> Void
  private let pinContentView: PinnedContentView

  var isZoomedScale: Bool { abs(pinScale - 1.0) > 0.005 }

  init(
    image: NSImage, logicalSize: CGSize, origin: CGPoint? = nil,
    defaults: UserDefaults = .standard,
    onCopy: @escaping () -> Bool, onClose: @escaping (CapturePinnedWindow) -> Void
  ) {
    (self.logicalSize, self.defaults) = (logicalSize, defaults)
    (self.onCopyAction, self.onCloseAction) = (onCopy, onClose)
    self.isBorderEnabled =
      (defaults.object(forKey: Self.borderEnabledKey) as? NSNumber)?.boolValue ?? true
    self.isShadowEnabled =
      (defaults.object(forKey: Self.shadowEnabledKey) as? NSNumber)?.boolValue ?? true
    self.pinContentView = PinnedContentView(image: image)
    let rect = NSRect(origin: origin ?? .zero, size: logicalSize)
    super.init(
      contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: false)
    if origin == nil { center() }
    isOpaque = false
    backgroundColor = .clear
    alphaValue = 1.0
    hasShadow = isShadowEnabled
    level = .floating
    hidesOnDeactivate = false
    becomesKeyOnlyIfNeeded = true
    isMovable = false
    isExcludedFromWindowsMenu = true
    animationBehavior = .none
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    isReleasedWhenClosed = false
    contentView = pinContentView
    pinContentView.setBorderVisible(isBorderEnabled)
    pinContentView.controlsBar.owner = self
  }

  override var canBecomeKey: Bool { !hasClosed && !PanelKeyboard.isReturningToFrontmostApp }
  override var canBecomeMain: Bool { false }
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }
  override func keyDown(with e: NSEvent) { if !handleKey(e) { super.keyDown(with: e) } }
  override func performKeyEquivalent(with e: NSEvent) -> Bool {
    handleKey(e) ? true : super.performKeyEquivalent(with: e)
  }

  private func handleKey(_ event: NSEvent) -> Bool {
    let flags = event.modifierFlags.intersection([.command, .control, .option])
    let char = event.charactersIgnoringModifiers?.lowercased() ?? ""
    switch (event.keyCode, flags, char) {
    case (53, _, _), (_, .command, "w"): closePin()
    case (_, .command, "c"): performCopy()
    case (_, [], "="), (_, [], "+"), (_, [], "]"): setPinScale(pinScale * 1.12, showHud: true)
    case (_, [], "-"), (_, [], "["): setPinScale(pinScale / 1.12, showHud: true)
    case (_, [], "0"): setPinScale(1.0, showHud: true)
    case (_, .command, "="), (_, .command, "+"), (_, .command, "]"): adjustOpacity(by: 0.10)
    case (_, .command, "-"), (_, .command, "["): adjustOpacity(by: -0.10)
    case (_, .command, "0"): setPinOpacity(1.0, showHud: true)
    case (_, [], "b"): toggleBorder()
    case (_, [], "s"): toggleShadow()
    default: return false
    }
    return true
  }

  @objc func performCopy() {
    guard !hasClosed, onCopyAction() else { return }
    pinContentView.showHud(ShellStrings.shared.text(CaptureToolsStringKey.loupeCopied))
  }

  @objc func toggleZoom() {
    setPinScale(isZoomedScale ? 1.0 : 1.5, showHud: true)
  }

  func clampedPinScale(_ value: CGFloat) -> CGFloat {
    let minEdgeScale = min(
      1.0,
      max(
        Self.minWindowEdge / max(1, logicalSize.width),
        Self.minWindowEdge / max(1, logicalSize.height)))
    let lowerBound = max(Self.minScale, minEdgeScale)
    guard value.isFinite else { return lowerBound }
    return min(Self.maxScale, max(lowerBound, value))
  }

  func applyPinFrame(_ nextFrame: NSRect, scale: CGFloat, showHud: Bool) {
    pinScale = scale
    pinContentView.controlsBar.closePopoverIfNeeded()
    setFrame(nextFrame, display: true)
    shadowInvalidationPending = false
    invalidateShadow()
    pinContentView.controlsBar.syncZoom(scale)
    pinContentView.needsLayout = true
    guard showHud else { return }
    let pct = Int((scale * 100).rounded())
    pinContentView.showHud(
      ShellStrings.shared.text(CaptureToolsStringKey.pinZoomPercent, count: pct))
  }

  func setPinScale(_ value: CGFloat, anchorScreenPoint: CGPoint? = nil, showHud: Bool) {
    guard value.isFinite else { return }
    let clamped = clampedPinScale(value)
    let w = max(1, round(logicalSize.width * clamped))
    let h = max(1, round(logicalSize.height * clamped))
    let old = frame
    let anchor = anchorScreenPoint ?? CGPoint(x: old.midX, y: old.midY)
    let fx = old.width > 0 ? min(1, max(0, (anchor.x - old.minX) / old.width)) : 0.5
    let fy = old.height > 0 ? min(1, max(0, (anchor.y - old.minY) / old.height)) : 0.5
    let nextOrigin = NSPoint(x: round(anchor.x - fx * w), y: round(anchor.y - fy * h))
    applyPinFrame(
      NSRect(origin: nextOrigin, size: NSSize(width: w, height: h)),
      scale: clamped, showHud: showHud)
  }

  func applyPinResize(
    from initialFrame: NSRect, initialScale: CGFloat, handle: SelectionHandle,
    delta: CGVector, centered: Bool, showHud: Bool
  ) {
    guard initialScale.isFinite, delta.dx.isFinite, delta.dy.isFinite else { return }
    let w0 = initialFrame.width
    let h0 = initialFrame.height
    let mul: CGFloat = centered ? 2 : 1
    let rawScale: CGFloat
    switch handle {
    case .left: rawScale = initialScale * ((w0 - delta.dx * mul) / max(1, w0))
    case .right: rawScale = initialScale * ((w0 + delta.dx * mul) / max(1, w0))
    case .top: rawScale = initialScale * ((h0 + delta.dy * mul) / max(1, h0))
    case .bottom: rawScale = initialScale * ((h0 - delta.dy * mul) / max(1, h0))
    case .topLeft, .topRight, .bottomLeft, .bottomRight:
      let sx: CGFloat = (handle == .topRight || handle == .bottomRight) ? 1 : -1
      let sy: CGFloat = (handle == .topLeft || handle == .topRight) ? 1 : -1
      let ux = w0 + sx * delta.dx * mul
      let uy = h0 + sy * delta.dy * mul
      rawScale = initialScale * ((ux * w0 + uy * h0) / max(1, w0 * w0 + h0 * h0))
    }
    let scale = clampedPinScale(rawScale)
    let w = max(1, round(logicalSize.width * scale))
    let h = max(1, round(logicalSize.height * scale))
    let x: CGFloat
    let y: CGFloat
    if centered {
      x = round(initialFrame.midX - w / 2)
      y = round(initialFrame.midY - h / 2)
    } else {
      x =
        switch handle {
        case .topLeft, .left, .bottomLeft: round(initialFrame.maxX - w)
        case .topRight, .right, .bottomRight: round(initialFrame.minX)
        case .top, .bottom: round(initialFrame.midX - w / 2)
        }
      y =
        switch handle {
        case .bottomLeft, .bottom, .bottomRight: round(initialFrame.maxY - h)
        case .topLeft, .top, .topRight: round(initialFrame.minY)
        case .left, .right: round(initialFrame.midY - h / 2)
        }
    }
    applyPinFrame(NSRect(x: x, y: y, width: w, height: h), scale: scale, showHud: showHud)
  }

  @objc func toggleBorder() { setBorderEnabled(!isBorderEnabled, showHud: true) }

  func setBorderEnabled(_ enabled: Bool, showHud: Bool) {
    isBorderEnabled = enabled
    defaults.set(enabled, forKey: Self.borderEnabledKey)
    pinContentView.setBorderVisible(enabled)
    pinContentView.controlsBar.syncBorder(enabled)
    guard showHud else { return }
    let key: CaptureToolsStringKey = enabled ? .pinBorderOn : .pinBorderOff
    pinContentView.showHud(ShellStrings.shared.text(key))
  }

  @objc func toggleShadow() { setShadowEnabled(!isShadowEnabled, showHud: true) }

  func setShadowEnabled(_ enabled: Bool, showHud: Bool) {
    isShadowEnabled = enabled
    defaults.set(enabled, forKey: Self.shadowEnabledKey)
    hasShadow = enabled
    shadowInvalidationPending = false
    invalidateShadow()
    pinContentView.controlsBar.syncShadow(enabled)
    guard showHud else { return }
    let key: CaptureToolsStringKey = enabled ? .pinShadowOn : .pinShadowOff
    pinContentView.showHud(ShellStrings.shared.text(key))
  }

  func adjustOpacity(by delta: CGFloat) { setPinOpacity(pinOpacity + delta, showHud: true) }
  func toggleTranslucentOpacity() {
    setPinOpacity(pinOpacity < 0.98 ? 1.0 : lastTranslucentOpacity, showHud: true)
  }

  func setPinOpacity(_ value: CGFloat, showHud: Bool) {
    guard value.isFinite else { return }
    let clamped = min(1.0, max(Self.minOpacity, value))
    guard abs(clamped - pinOpacity) > 0.0005 else { return }
    pinOpacity = clamped
    if clamped < 0.98 { lastTranslucentOpacity = clamped }
    pinContentView.imageSurfaceView.alphaValue = clamped
    scheduleShadowInvalidation()
    pinContentView.controlsBar.syncOpacity(clamped)
    guard showHud else { return }
    let pct = Int((clamped * 100).rounded())
    let text = ShellStrings.shared.text(CaptureToolsStringKey.opacityPercent, count: pct)
    pinContentView.showHud(text)
  }

  @objc func closePin() {
    guard !hasClosed else { return }
    hasClosed = true
    shadowInvalidationPending = false
    pinContentView.teardown()
    orderOutReturningKeyboard()
    close()
    onCloseAction(self)
  }
}

final class PinnedContentView: NSView {
  let imageSurfaceView = NSView()
  let imageView = NSImageView()
  let borderOverlayView: NSView = PinnedBorderOverlayView(frame: .zero)
  let controlsBar = CapturePinnedControlsBar()
  let hudLabel = NSTextField(labelWithString: "")
  let hudBar: AnnotationGlassBar
  let pointer = MiniPanelPointer()
  weak var hoveredButton: AnnotationToolbarButton?
  var isHovered = false
  var isDragging = false
  var hudTask: Task<Void, Never>?
  var dragOrigin: CGPoint?
  var pressStart: CGPoint?
  var didDrag = false
  var resizeSession: PinResizeSession?
  var trackingArea: NSTrackingArea?

  var pinnedWindow: CapturePinnedWindow? { window as? CapturePinnedWindow }

  init(image: NSImage) {
    hudBar = AnnotationGlassBar(groups: [[hudLabel]], blending: .behindWindow, padding: 6)
    super.init(frame: .zero)
    wantsLayer = true
    layer?.backgroundColor = nil
    imageSurfaceView.wantsLayer = true
    if let surface = imageSurfaceView.layer {
      (surface.cornerRadius, surface.cornerCurve, surface.masksToBounds) = (8, .continuous, true)
      surface.backgroundColor = nil
    }
    imageView.image = image
    imageView.imageScaling = .scaleProportionallyUpOrDown
    imageSurfaceView.addSubview(imageView)
    imageSurfaceView.addSubview(borderOverlayView)
    addSubview(imageSurfaceView)
    hudLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
    (hudLabel.textColor, hudLabel.alignment) = (.labelColor, .center)
    for view in [controlsBar, hudBar] {
      (view.isHidden, view.alphaValue) = (true, 0)
      addSubview(view)
    }
    controlsBar.onKeepVisibleChanged = { [weak self] in self?.refreshHoverVisibility() }
    pointer.isNear = { [weak self] point in self?.isPointerNear(point) == true }
    pointer.isBusy = { [weak self] in
      guard let self else { return false }
      return self.resizeSession != nil || self.isDragging
    }
    pointer.onMove = { [weak self] point, _ in self?.syncPointer(at: point) }
    pointer.onFrame = { [weak self] _, _ in self?.syncPointer(at: NSEvent.mouseLocation) }
    NotificationCenter.default.addObserver(
      self, selector: #selector(handleStringsDidChange), name: ShellStrings.didChange, object: nil)
  }

  @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }
  isolated deinit {
    hudTask?.cancel()
    pointer.stop()
  }

  func setBorderVisible(_ visible: Bool) { borderOverlayView.isHidden = !visible }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window != nil {
      pointer.start(in: self)
      pointer.wake()
    } else {
      pointer.stop()
    }
  }

  func teardown() {
    hudTask?.cancel()
    hudTask = nil
    pointer.stop()
    resetPointerInteraction()
    controlsBar.closePopoverIfNeeded()
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func handleStringsDidChange() { controlsBar.applyStrings() }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let local = convert(point, from: superview)
    guard bounds.contains(local) else { return nil }
    return controlsBar.hitTest(local) ?? self
  }

  override func layout() {
    super.layout()
    imageSurfaceView.frame = bounds
    imageView.frame = imageSurfaceView.bounds
    borderOverlayView.frame = imageSurfaceView.bounds
    layoutControlsAndHud()
  }

  override func menu(for event: NSEvent) -> NSMenu? { buildContextMenu() }
}
