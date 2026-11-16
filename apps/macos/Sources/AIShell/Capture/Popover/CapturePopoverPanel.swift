import AppKit
import QuartzCore

/// Transient floating popover panel for capture tools and pins using the shell's native glass
/// surface, a 24 pt transparent shadow margin, non-focus-stealing defaults with explicit
/// click-to-focus support for text inputs, and dynamic charcoal/paper legibility backing.
@MainActor
final class CapturePopoverPanel: ActiveGlassPanel {
  static let cornerRadius: CGFloat = 16
  static let margin: CGFloat = 24

  var onWillClose: (() -> Void)?
  var onDidClose: (() -> Void)?
  var isShown: Bool { isVisible }
  private(set) weak var openerView: NSView?

  private weak var hostWindow: NSWindow?
  private weak var previousResponder: NSResponder?
  private weak var surfaceView: PopoverSurfaceView?
  private weak var hostedContentView: NSView?
  private var openerLocalRect: NSRect?
  private var anchorScreenRect: NSRect?
  private var surfaceScreenRect: NSRect?
  private var allowsKey = false
  private var isReleasingKeyFocus = false
  private var isDismissing = false
  private var fadeGeneration = 0
  private var localMouseMonitor: Any?
  private var globalMouseMonitor: Any?
  private var localKeyMonitor: Any?
  private var hostCloseObserver: NSObjectProtocol?
  private var displayObserver: NSObjectProtocol?

  init() {
    super.init(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    isOpaque = false
    backgroundColor = .clear
    hasShadow = false
    hidesOnDeactivate = false
    isReleasedWhenClosed = false
    becomesKeyOnlyIfNeeded = true
    isExcludedFromWindowsMenu = true
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
    animationBehavior = .none
  }

  override var canBecomeKey: Bool { allowsKey }
  override var canBecomeMain: Bool { false }

  /// Prevents AppKit from pushing borderless capture popovers below the menu bar.
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }

  isolated deinit { removeMonitors() }

  func show(
    contentView: NSView,
    contentSize: NSSize,
    relativeTo positioningRect: NSRect,
    of positioningView: NSView,
    preferredEdge: NSRectEdge = .minY
  ) {
    if isVisible { dismissPopover() }
    CaptureTooltipPresenter.shared.dismiss()

    let host = positioningView.window
    (openerView, openerLocalRect, hostWindow) = (positioningView, positioningRect, host)
    previousResponder = host?.firstResponder
    level = NSWindow.Level(
      rawValue: max(ToolbarWindow.aboveCapture.rawValue, (host?.level.rawValue ?? 0) + 2))

    let anchor =
      host.map { $0.convertToScreen(positioningView.convert(positioningRect, to: nil)) }
      ?? positioningView.convert(positioningRect, to: nil)
    let surfaceRect = Self.placementFrame(
      for: anchor, contentSize: contentSize, preferredEdge: preferredEdge, hostWindow: host)
    (anchorScreenRect, surfaceScreenRect) = (anchor, surfaceRect)

    let container = buildContainer(
      contentView: contentView, contentSize: contentSize, positioningView: positioningView)
    (self.contentView, hostedContentView) = (container, contentView)
    installMonitors(hostWindow: host)

    fadeGeneration += 1
    let generation = fadeGeneration
    let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    alphaValue = reduceMotion ? 1 : 0
    setFrame(surfaceRect.insetBy(dx: -Self.margin, dy: -Self.margin), display: true)
    container.layoutSubtreeIfNeeded()
    surfaceView?.updateBackingFill()
    orderFrontRegardless()
    guard !reduceMotion else { return }
    NSAnimationContext.runAnimationGroup { context in
      (context.duration, context.timingFunction) = (0.11, CAMediaTimingFunction(name: .easeOut))
      animator().alphaValue = 1
    } completionHandler: { [weak self] in
      Task { @MainActor in
        if let self, self.fadeGeneration == generation { self.alphaValue = 1 }
      }
    }
  }

  func dismissPopover() {
    guard isVisible, !isDismissing else { return }
    isDismissing = true
    defer { isDismissing = false }
    fadeGeneration += 1
    CaptureTooltipPresenter.shared.dismiss()
    onWillClose?()
    removeMonitors()
    releaseKeyFocus()
    orderOutReturningKeyboard()
    alphaValue = 1
    hostedContentView?.removeFromSuperview()
    (hostedContentView, surfaceView, contentView) = (nil, nil, nil)
    (openerView, openerLocalRect, hostWindow, previousResponder) = (nil, nil, nil, nil)
    (anchorScreenRect, surfaceScreenRect) = (nil, nil)
    onDidClose?()
  }

  func requestKeyFocus(for responder: NSResponder) {
    if !allowsKey, let hostWindow { previousResponder = hostWindow.firstResponder }
    allowsKey = true
    makeKey()
    makeFirstResponder(responder)
  }

  func releaseKeyFocus() {
    guard allowsKey, !isReleasingKeyFocus else { return }
    isReleasingKeyFocus = true
    defer { isReleasingKeyFocus = false }
    endEditing(for: nil)
    if isKeyWindow {
      hostWindow?.makeKey()
      if let view = previousResponder as? NSView {
        if view.window === hostWindow { hostWindow?.makeFirstResponder(view) }
      } else if let previousResponder {
        hostWindow?.makeFirstResponder(previousResponder)
      }
    }
    allowsKey = false
  }

  private func buildContainer(
    contentView: NSView, contentSize: NSSize, positioningView: NSView
  ) -> NSView {
    let containerSize = NSSize(
      width: contentSize.width + Self.margin * 2,
      height: contentSize.height + Self.margin * 2)
    let container = NSView(frame: NSRect(origin: .zero, size: containerSize))
    container.wantsLayer = true

    let surface = PopoverSurfaceView(frame: NSRect(origin: .zero, size: contentSize))
    surface.clipsToBounds = true
    surfaceView = surface

    let material = NativeMaterialView(.menu)
    material.view.frame = NSRect(origin: NSPoint(x: Self.margin, y: Self.margin), size: contentSize)
    GlassSurface.attach(material, content: surface)
    GlassSurface.shape(material, content: surface, cornerRadius: Self.cornerRadius)
    if positioningView.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua,
      !GlassSurface.isDark
    {
      GlassSurface.pinDark(material)
    }

    contentView.frame = NSRect(origin: .zero, size: contentSize)
    contentView.autoresizingMask = [.width, .height]
    surface.backingView.frame = surface.bounds
    surface.backingView.autoresizingMask = [.width, .height]
    surface.addSubview(surface.backingView)
    surface.addSubview(contentView, positioned: .above, relativeTo: surface.backingView)
    container.addSubview(material.view)
    return container
  }

  private func installMonitors(hostWindow: NSWindow?) {
    removeMonitors()
    let mouseMask: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
    localMouseMonitor = NSEvent.addLocalMonitorForEvents(matching: mouseMask) { [weak self] event in
      MainActor.assumeIsolated { self?.shouldPassLocalMouseDown(event) ?? true } ? event : nil
    }
    globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: mouseMask) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self, self.isVisible,
          !self.isPointInSystemColorPanel(NSEvent.mouseLocation, eventWindow: nil)
        else { return }
        self.dismissPopover()
      }
    }
    localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      let passes = MainActor.assumeIsolated {
        guard let self, self.isVisible, event.keyCode == 53, !self.allowsKey else { return true }
        self.dismissPopover()
        return false
      }
      return passes ? event : nil
    }
    if let hostWindow {
      hostCloseObserver = NotificationCenter.default.addObserver(
        forName: NSWindow.willCloseNotification, object: hostWindow, queue: .main
      ) { [weak self] _ in MainActor.assumeIsolated { self?.dismissPopover() } }
    }
    displayObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
      queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.surfaceView?.updateBackingFill() } }
  }

  private func removeMonitors() {
    for monitor in [localMouseMonitor, globalMouseMonitor, localKeyMonitor].compactMap({ $0 }) {
      NSEvent.removeMonitor(monitor)
    }
    (localMouseMonitor, globalMouseMonitor, localKeyMonitor) = (nil, nil, nil)
    if let hostCloseObserver { NotificationCenter.default.removeObserver(hostCloseObserver) }
    if let displayObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(displayObserver)
    }
    (hostCloseObserver, displayObserver) = (nil, nil)
  }

  private func shouldPassLocalMouseDown(_ event: NSEvent) -> Bool {
    guard isVisible else { return true }
    let screenPoint =
      event.window?.convertPoint(toScreen: event.locationInWindow) ?? NSEvent.mouseLocation
    if isPointInSystemColorPanel(screenPoint, eventWindow: event.window) { return true }
    if let surfaceScreenRect, surfaceScreenRect.contains(screenPoint),
      event.window === self || event.window == nil
    {
      if allowsKey, !isEditableTextHit(at: event.locationInWindow) { releaseKeyFocus() }
      return true
    }
    if let openerRect = currentOpenerScreenRect(), openerRect.contains(screenPoint) {
      if event.window === self {
        dismissPopover()
        return false
      }
      if event.window === openerView?.window { return true }
    }
    dismissPopover()
    return event.window !== self
  }

  private func isPointInSystemColorPanel(_ screenPoint: NSPoint, eventWindow: NSWindow?) -> Bool {
    guard NSColorPanel.sharedColorPanelExists else { return false }
    let colorPanel = NSColorPanel.shared
    guard colorPanel.isVisible else { return false }
    return eventWindow === colorPanel || eventWindow?.parent === colorPanel
      || (eventWindow !== self && colorPanel.frame.contains(screenPoint))
  }

  private func isEditableTextHit(at locationInWindow: NSPoint) -> Bool {
    var current = contentView?.hitTest(locationInWindow)
    while let view = current {
      if let textView = view as? NSTextView, textView.isEditable { return true }
      if let textField = view as? NSTextField, textField.isEditable { return true }
      if view === surfaceView { break }
      current = view.superview
    }
    return false
  }

  private func currentOpenerScreenRect() -> NSRect? {
    if let openerView, let window = openerView.window, let rect = openerLocalRect {
      return window.convertToScreen(openerView.convert(rect, to: nil))
    }
    return anchorScreenRect
  }

  private static func placementFrame(
    for anchor: NSRect, contentSize: NSSize, preferredEdge: NSRectEdge, hostWindow: NSWindow?
  ) -> NSRect {
    let center = NSPoint(x: anchor.midX, y: anchor.midY)
    let screen =
      NSScreen.screens.first { $0.frame.contains(center) }
      ?? NSScreen.screens.first { $0.frame.intersects(anchor) }
      ?? hostWindow?.screen ?? NSScreen.main ?? NSScreen.screens.first
    let safe = (screen?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)).insetBy(
      dx: 8, dy: 8)
    let gap: CGFloat = 6
    let below = anchor.minY - gap - contentSize.height
    let above = anchor.maxY + gap
    let rawY: CGFloat =
      preferredEdge == .minY
      ? (below >= safe.minY || above + contentSize.height > safe.maxY ? below : above)
      : (above + contentSize.height <= safe.maxY || below < safe.minY ? above : below)
    let maxX = max(safe.minX, safe.maxX - contentSize.width)
    let maxY = max(safe.minY, safe.maxY - contentSize.height)
    let x = max(safe.minX, min((anchor.midX - contentSize.width / 2).rounded(), maxX))
    let y = max(safe.minY, min(rawY.rounded(), maxY))
    return NSRect(origin: NSPoint(x: x, y: y), size: contentSize)
  }
}

/// Interactive rounded card container holding a full-bounds legibility backing behind content.
@MainActor
private final class PopoverSurfaceView: NSView {
  let backingView: PopoverBackingView = {
    let view = PopoverBackingView()
    view.wantsLayer = true
    return view
  }()

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func resetCursorRects() { addCursorRect(bounds, cursor: PointerRole.passive.cursor) }

  override func layout() {
    super.layout()
    backingView.frame = bounds
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    updateBackingFill()
  }

  func updateBackingFill() {
    backingView.frame = bounds
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      let alpha = ReduceTransparencyObserver.isReduced ? 1.0 : (dark ? 0.88 : 0.92)
      let fill =
        dark
        ? NSColor(srgbRed: 24 / 255, green: 24 / 255, blue: 26 / 255, alpha: alpha)
        : NSColor(srgbRed: 250 / 255, green: 250 / 255, blue: 252 / 255, alpha: alpha)
      backingView.layer?.backgroundColor = fill.cgColor
    }
  }
}

@MainActor
private final class PopoverBackingView: NSView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
