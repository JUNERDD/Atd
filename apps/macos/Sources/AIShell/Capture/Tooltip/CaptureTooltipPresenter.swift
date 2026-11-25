import AICore
import AppKit

/// Preferred placement edge relative to a hovered control.
enum CaptureTooltipEdge { case above, below }

/// Shared floating tooltip presenter above `.screenSaver`, `.floating`, and popover windows.
@MainActor
final class CaptureTooltipPresenter {
  static let shared = CaptureTooltipPresenter()

  private var panel: ActiveGlassPanel?
  private let tooltipView = CaptureTooltipView()
  private weak var activeAnchor: NSView?
  private weak var pendingAnchor: NSView?
  private var pendingCopy: (text: String, edge: CaptureTooltipEdge?)?
  private var warmUntil = Date.distantPast
  private var timerTask: Task<Void, Never>?
  private var fadeGeneration = 0
  private var eventMonitor: Any?

  private init() {}

  /// Begins hover timing (or swaps immediately while warm) for `anchor`.
  func hoverEntered(anchor: NSView, text: String?, edge: CaptureTooltipEdge? = nil) {
    guard let trimmed = Self.clean(text) else {
      hoverExited(anchor: anchor)
      return
    }
    guard !anchor.isHiddenOrHasHiddenAncestor, anchor.window?.isVisible == true else { return }
    if activeAnchor != nil || Date() < warmUntil {
      present(anchor: anchor, text: trimmed, edge: edge)
      return
    }
    clearPending()
    (pendingAnchor, pendingCopy) = (anchor, (trimmed, edge))
    setMonitoring(true)
    timerTask = Task { @MainActor [weak self, weak anchor] in
      try? await Task.sleep(for: .seconds(MiniPanelLabelTiming.warmUp))
      guard let self, let anchor, !Task.isCancelled, self.pendingAnchor === anchor,
        let copy = self.pendingCopy
      else { return }
      self.present(anchor: anchor, text: copy.text, edge: copy.edge, requirePointer: true)
    }
  }

  /// Lingers briefly on exit so crossing toolbar gaps keeps sibling swaps instant.
  func hoverExited(anchor: NSView) {
    if pendingAnchor === anchor { clearPending() }
    guard activeAnchor === anchor else {
      setMonitoring(activeAnchor != nil || pendingAnchor != nil)
      return
    }
    warmUntil = Date().addingTimeInterval(MiniPanelLabelTiming.coolDown)
    timerTask?.cancel()
    timerTask = Task { @MainActor [weak self, weak anchor] in
      try? await Task.sleep(for: .seconds(MiniPanelLabelTiming.linger))
      guard let self, !Task.isCancelled, self.activeAnchor === anchor else { return }
      self.hidePanel(animated: true)
    }
  }

  /// Updates active or pending tooltip copy when `anchor`'s text changes dynamically.
  func updateTooltip(for anchor: NSView, text: String?, edge: CaptureTooltipEdge? = nil) {
    guard let valid = Self.clean(text) else {
      dismiss(for: anchor)
      return
    }
    if activeAnchor === anchor {
      present(anchor: anchor, text: valid, edge: edge)
    } else if pendingAnchor === anchor {
      pendingCopy = (valid, edge)
    }
  }

  /// Dismisses any pending or visible tooltip immediately (`anchor` scopes to one view).
  func dismiss(for anchor: NSView? = nil) {
    if anchor == nil || anchor === pendingAnchor { clearPending() }
    if anchor == nil { warmUntil = .distantPast }
    if anchor == nil || anchor === activeAnchor { hidePanel(animated: false) }
    setMonitoring(activeAnchor != nil || pendingAnchor != nil)
  }

  static func clean(_ text: String?) -> String? {
    let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed?.isEmpty == true ? nil : trimmed
  }

  private func present(
    anchor: NSView, text: String, edge: CaptureTooltipEdge?, requirePointer: Bool = false
  ) {
    guard let window = anchor.window, window.isVisible, !anchor.isHiddenOrHasHiddenAncestor,
      !anchor.bounds.isEmpty
    else {
      dismiss(for: anchor)
      return
    }
    let anchorScreenRect = window.convertToScreen(anchor.convert(anchor.bounds, to: nil))
    guard
      !requirePointer || anchorScreenRect.insetBy(dx: -2, dy: -2).contains(NSEvent.mouseLocation)
    else {
      dismiss(for: anchor)
      return
    }
    let panel = panel ?? makePanel()
    let dark = anchor.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    let size = tooltipView.update(text: text, dark: dark)
    guard
      let frame = Self.placementFrame(
        for: anchor, anchorRect: anchorScreenRect, window: window, size: size, explicit: edge)
    else {
      dismiss(for: anchor)
      return
    }
    clearPending()
    let fade = !panel.isVisible && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    panel.level = NSWindow.Level(
      rawValue: max(NSWindow.Level.popUpMenu.rawValue, window.level.rawValue + 2))
    panel.setFrame(frame, display: true)
    tooltipView.needsLayout = true
    tooltipView.layoutSubtreeIfNeeded()
    panel.invalidateShadow()
    activeAnchor = anchor
    warmUntil = Date().addingTimeInterval(MiniPanelLabelTiming.coolDown)
    setMonitoring(true)
    (fadeGeneration, panel.alphaValue) = (fadeGeneration + 1, fade ? 0 : 1)
    panel.orderFrontRegardless()
    animate(panel, to: 1, duration: fade ? 0.12 : 0, hide: false)
  }

  private func hidePanel(animated: Bool) {
    clearPending()
    setMonitoring(false)
    (activeAnchor, fadeGeneration) = (nil, fadeGeneration + 1)
    guard let panel, panel.isVisible else { return }
    guard animated, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
      panel.orderOut(nil)
      return
    }
    animate(panel, to: 0, duration: 0.12, hide: true)
  }

  private func animate(
    _ panel: ActiveGlassPanel, to alpha: CGFloat, duration: TimeInterval, hide: Bool
  ) {
    let generation = fadeGeneration
    NSAnimationContext.runAnimationGroup(
      {
        $0.duration = duration
        $0.timingFunction = CAMediaTimingFunction(name: alpha > 0 ? .easeOut : .easeIn)
        panel.animator().alphaValue = alpha
      },
      completionHandler: { [weak self, weak panel] in
        guard hide else { return }
        Task { @MainActor in
          if let self, self.fadeGeneration == generation { panel?.orderOut(nil) }
        }
      })
    if duration == 0 { panel.alphaValue = alpha }
  }

  private func clearPending() {
    timerTask?.cancel()
    (timerTask, pendingAnchor, pendingCopy) = (nil, nil, nil)
  }

  private func makePanel() -> ActiveGlassPanel {
    let p = ActiveGlassPanel(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered, defer: true)
    (p.ignoresMouseEvents, p.isOpaque, p.hasShadow) = (true, false, true)
    (p.isReleasedWhenClosed, p.hidesOnDeactivate) = (false, false)
    p.animationBehavior = .none
    (p.backgroundColor, p.contentView) = (.clear, tooltipView)
    p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
    panel = p
    return p
  }

  private func setMonitoring(_ active: Bool) {
    if !active {
      if let eventMonitor { NSEvent.removeMonitor(eventMonitor) }
      eventMonitor = nil
    } else if eventMonitor == nil {
      eventMonitor = NSEvent.addLocalMonitorForEvents(
        matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .keyDown]
      ) { [weak self] event in
        if !CaptureKeyEventFilter.shouldSwallowPinnedKey(event) {
          MainActor.assumeIsolated { self?.dismiss() }
        }
        return event
      }
    }
  }

  private static func placementFrame(
    for anchor: NSView, anchorRect rect: NSRect, window: NSWindow, size: NSSize,
    explicit: CaptureTooltipEdge?
  ) -> NSRect? {
    let hit = NSScreen.screens.first { $0.frame.contains(NSPoint(x: rect.midX, y: rect.midY)) }
    guard let screen = hit ?? window.screen ?? NSScreen.main else { return nil }
    let safe = screen.frame.insetBy(dx: 8, dy: 8)
    let secondary = sequence(first: anchor, next: \.superview).dropFirst().contains {
      $0 is AnnotationStyleBar || $0 is AnnotationCommandRow || $0 is AnnotationAskBar
    }
    let above = rect.maxY + 6
    let below = rect.minY - 6 - size.height
    let preferAbove = explicit.map { $0 == .above } ?? !secondary
    let rawY =
      preferAbove
      ? (above + size.height <= safe.maxY || below < safe.minY ? above : below)
      : (below >= safe.minY || above + size.height > safe.maxY ? below : above)
    return NSRect(
      x: max(safe.minX, min((rect.midX - size.width / 2).rounded(), safe.maxX - size.width)),
      y: max(safe.minY, min(rawY, safe.maxY - size.height)).rounded(),
      width: size.width, height: size.height)
  }
}

extension NSView {
  /// Returns the custom tooltip stored on this view (if set via ``setCaptureTooltip``).
  var captureTooltip: String? { tooltipHelper?.tooltipText }
  private var tooltipHelper: CaptureTooltipTrackingHelper? {
    subviews.first { $0 is CaptureTooltipTrackingHelper } as? CaptureTooltipTrackingHelper
  }

  /// Routes hover tooltips for non-button views through ``CaptureTooltipPresenter``.
  func setCaptureTooltip(_ text: String?, edge: CaptureTooltipEdge? = nil) {
    if let button = self as? AnnotationToolbarButton {
      button.applyCaptureTooltip(text, edge: edge)
      return
    }
    guard let trimmed = CaptureTooltipPresenter.clean(text) else {
      CaptureTooltipPresenter.shared.dismiss(for: self)
      tooltipHelper?.removeFromSuperview()
      return
    }
    let helper = tooltipHelper ?? CaptureTooltipTrackingHelper.attach(to: self)
    (helper.tooltipText, helper.preferredEdge) = (trimmed, edge)
    CaptureTooltipPresenter.shared.updateTooltip(for: self, text: trimmed, edge: edge)
  }
}

private final class CaptureTooltipTrackingHelper: NSView {
  var tooltipText = ""
  var preferredEdge: CaptureTooltipEdge?
  private var trackingArea: NSTrackingArea?
  private var isPointerHovered = false

  static func attach(to host: NSView) -> Self {
    let view = Self(frame: .zero)
    view.translatesAutoresizingMaskIntoConstraints = false
    host.addSubview(view)
    NSLayoutConstraint.activate([
      view.leadingAnchor.constraint(equalTo: host.leadingAnchor),
      view.trailingAnchor.constraint(equalTo: host.trailingAnchor),
      view.topAnchor.constraint(equalTo: host.topAnchor),
      view.bottomAnchor.constraint(equalTo: host.bottomAnchor),
    ])
    return view
  }

  override func isAccessibilityElement() -> Bool { false }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
    syncPointerHover()
  }

  override func mouseEntered(with event: NSEvent) {
    guard let host = superview, !host.isHiddenOrHasHiddenAncestor,
      (host as? NSControl)?.isEnabled != false
    else { return }
    isPointerHovered = true
    CaptureTooltipPresenter.shared.hoverEntered(
      anchor: host, text: tooltipText, edge: preferredEdge)
  }

  override func mouseExited(with event: NSEvent) {
    isPointerHovered = false
    if let host = superview { CaptureTooltipPresenter.shared.hoverExited(anchor: host) }
  }

  override func viewDidHide() {
    super.viewDidHide()
    clearHoverAndDismiss()
  }

  override func viewDidUnhide() {
    super.viewDidUnhide()
    syncPointerHover()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      clearHoverAndDismiss()
    } else {
      syncPointerHover()
    }
  }

  private func clearHoverAndDismiss() {
    isPointerHovered = false
    if let host = superview { CaptureTooltipPresenter.shared.dismiss(for: host) }
  }

  private func syncPointerHover() {
    guard let host = superview, let window, window.isVisible, !host.isHiddenOrHasHiddenAncestor,
      !bounds.isEmpty, (host as? NSControl)?.isEnabled != false
    else {
      if isPointerHovered {
        isPointerHovered = false
        if let host = superview { CaptureTooltipPresenter.shared.hoverExited(anchor: host) }
      }
      return
    }
    let inside = bounds.contains(convert(window.mouseLocationOutsideOfEventStream, from: nil))
    guard inside != isPointerHovered else { return }
    isPointerHovered = inside
    if inside {
      CaptureTooltipPresenter.shared.hoverEntered(
        anchor: host, text: tooltipText, edge: preferredEdge)
    } else {
      CaptureTooltipPresenter.shared.hoverExited(anchor: host)
    }
  }
}
