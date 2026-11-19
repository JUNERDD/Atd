import AICore
import AppKit

/// Active pointer resize snapshot captured on mouse-down so drag math never accumulates drift.
struct PinResizeSession {
  let handle: SelectionHandle
  let startMouse: CGPoint
  let initialFrame: NSRect
  let initialScale: CGFloat
}

extension PinnedContentView {
  func resizeHandle(at localPoint: CGPoint) -> SelectionHandle? {
    guard bounds.contains(localPoint), controlsBar.hitTest(localPoint) == nil else { return nil }
    let cornerBand = min(14, bounds.width * 0.3, bounds.height * 0.3)
    let nearLeft = localPoint.x <= bounds.minX + cornerBand
    let nearRight = localPoint.x >= bounds.maxX - cornerBand
    let nearBottom = localPoint.y <= bounds.minY + cornerBand
    let nearTop = localPoint.y >= bounds.maxY - cornerBand
    if nearBottom && nearLeft { return .bottomLeft }
    if nearBottom && nearRight { return .bottomRight }
    if nearTop && nearLeft { return .topLeft }
    if nearTop && nearRight { return .topRight }

    let edgeBand = min(7, bounds.width * 0.2, bounds.height * 0.2)
    if localPoint.x <= bounds.minX + edgeBand { return .left }
    if localPoint.x >= bounds.maxX - edgeBand { return .right }
    if localPoint.y <= bounds.minY + edgeBand { return .bottom }
    if localPoint.y >= bounds.maxY - edgeBand { return .top }
    return nil
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    let area = NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .mouseMoved, .cursorUpdate, .activeAlways],
      owner: self)
    addTrackingArea(area)
    trackingArea = area
    syncPointer(at: NSEvent.mouseLocation)
  }

  override func mouseEntered(with event: NSEvent) { syncPointer(at: NSEvent.mouseLocation) }
  override func mouseExited(with event: NSEvent) { syncPointer(at: NSEvent.mouseLocation) }
  override func mouseMoved(with event: NSEvent) { syncPointer(at: NSEvent.mouseLocation) }
  override func cursorUpdate(with event: NSEvent) { syncPointer(at: NSEvent.mouseLocation) }

  override func mouseDown(with event: NSEvent) {
    CaptureTooltipPresenter.shared.dismiss()
    pinnedWindow?.takeKeyboard()
    window?.makeFirstResponder(self)
    let local = convert(event.locationInWindow, from: nil)
    let location = NSEvent.mouseLocation
    pressStart = location
    didDrag = false
    if let handle = resizeHandle(at: local), let pinnedWindow {
      resizeSession = PinResizeSession(
        handle: handle,
        startMouse: location,
        initialFrame: pinnedWindow.frame,
        initialScale: pinnedWindow.pinScale)
      isDragging = false
      dragOrigin = nil
    } else {
      resizeSession = nil
      isDragging = true
      dragOrigin = location
    }
    refreshHoverVisibility()
    syncPointer(at: location)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let start = pressStart else { return }
    let location = NSEvent.mouseLocation
    if !didDrag {
      guard hypot(location.x - start.x, location.y - start.y) >= 2 else { return }
      didDrag = true
    }
    if let session = resizeSession {
      applyResize(session: session, mouseLocation: location, flags: event.modifierFlags)
    } else if isDragging, let origin = dragOrigin, let frameOrigin = window?.frame.origin {
      window?.setFrameOrigin(
        NSPoint(x: frameOrigin.x + location.x - origin.x, y: frameOrigin.y + location.y - origin.y))
      dragOrigin = location
    }
    syncPointer(at: location)
  }

  override func flagsChanged(with event: NSEvent) {
    if didDrag, let session = resizeSession {
      applyResize(
        session: session, mouseLocation: NSEvent.mouseLocation, flags: event.modifierFlags)
      syncPointer(at: NSEvent.mouseLocation)
    }
    super.flagsChanged(with: event)
  }

  override func mouseUp(with event: NSEvent) {
    let shouldToggleZoom = !didDrag && event.clickCount == 2
    isDragging = false
    resizeSession = nil
    dragOrigin = nil
    pressStart = nil
    didDrag = false
    if shouldToggleZoom { pinnedWindow?.toggleZoom() }
    syncPointer(at: NSEvent.mouseLocation)
    refreshHoverVisibility()
  }

  override func scrollWheel(with event: NSEvent) {
    switch CaptureSliderWheel.step(for: event) {
    case .consumedNoOp:
      return
    case .delta(let unit):
      CaptureTooltipPresenter.shared.dismiss()
      if event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command) {
        pinnedWindow?.adjustOpacity(by: CGFloat(unit) * (1.0 - CapturePinnedWindow.minOpacity))
      } else if let pinnedWindow {
        pinnedWindow.setPinScale(
          pinnedWindow.pinScale * exp(CGFloat(unit) * 1.4),
          anchorScreenPoint: NSEvent.mouseLocation, showHud: true)
      }
      syncPointer(at: NSEvent.mouseLocation)
    }
  }

  override func magnify(with event: NSEvent) {
    guard let pinnedWindow else { return }
    CaptureTooltipPresenter.shared.dismiss()
    let factor = max(0.5, 1 + event.magnification)
    pinnedWindow.setPinScale(
      pinnedWindow.pinScale * factor, anchorScreenPoint: NSEvent.mouseLocation, showHud: true)
    syncPointer(at: NSEvent.mouseLocation)
  }

  func isPointerNear(_ screenPoint: CGPoint) -> Bool {
    guard let window, window.isVisible else { return false }
    return window.frame.insetBy(dx: -24, dy: -24).contains(screenPoint)
  }

  func syncPointer(at screenPoint: CGPoint) {
    if let resizeSession {
      clearHoveredButton()
      if !isHovered { setHovered(true) }
      resizeSession.handle.cursor.set()
      return
    }
    if isDragging {
      clearHoveredButton()
      if !isHovered { setHovered(true) }
      PointerRole.grabbing.cursor.set()
      return
    }
    guard let window, window.isVisible,
      CaptureCursorOwnership.ownsPointer(in: window, at: screenPoint)
    else {
      clearHover(releasingCursorAt: screenPoint)
      return
    }
    let local = convert(window.convertPoint(fromScreen: screenPoint), from: nil)
    guard bounds.contains(local) else {
      clearHover(releasingCursorAt: screenPoint)
      return
    }
    if !isHovered { setHovered(true) }
    if let button = hitActionButton(at: screenPoint, in: window) {
      updateHoveredButton(button)
      PointerRole(button: button).cursor.set()
    } else {
      clearHoveredButton()
      (resizeHandle(at: local)?.cursor ?? PointerRole.passive.cursor).set()
    }
  }

  func resetPointerInteraction() {
    let hadHover = resizeSession != nil || isDragging || isHovered || hoveredButton != nil
    clearHoveredButton()
    resizeSession = nil
    isDragging = false
    dragOrigin = nil
    pressStart = nil
    didDrag = false
    isHovered = false
    if hadHover { releaseHoverCursor(at: NSEvent.mouseLocation) }
  }

  private func setHovered(_ hovered: Bool) {
    isHovered = hovered
    refreshHoverVisibility()
  }

  private func applyResize(
    session: PinResizeSession, mouseLocation: CGPoint, flags: NSEvent.ModifierFlags
  ) {
    let delta = CGVector(
      dx: mouseLocation.x - session.startMouse.x, dy: mouseLocation.y - session.startMouse.y)
    let centered = flags.intersection(.deviceIndependentFlagsMask).contains(.option)
    pinnedWindow?.applyPinResize(
      from: session.initialFrame,
      initialScale: session.initialScale,
      handle: session.handle,
      delta: delta,
      centered: centered,
      showHud: true)
  }

  private func hitActionButton(at screenPoint: CGPoint, in window: NSWindow)
    -> AnnotationToolbarButton?
  {
    guard !controlsBar.isHidden, controlsBar.alphaValue >= 0.05 else { return nil }
    return controlsBar.actionButtons.first { button in
      guard button.isEnabled, !button.isHiddenOrHasHiddenAncestor, !button.bounds.isEmpty else {
        return false
      }
      return window.convertToScreen(button.convert(button.bounds, to: nil)).contains(screenPoint)
    }
  }

  private func updateHoveredButton(_ button: AnnotationToolbarButton) {
    guard hoveredButton !== button else { return }
    hoveredButton?.isHovered = false
    button.isHovered = true
    hoveredButton = button
  }

  private func clearHoveredButton() {
    hoveredButton?.isHovered = false
    hoveredButton = nil
  }

  private func clearHover(releasingCursorAt screenPoint: CGPoint) {
    let hadHover = isHovered || hoveredButton != nil
    clearHoveredButton()
    if isHovered { setHovered(false) }
    if hadHover { releaseHoverCursor(at: screenPoint) }
  }

  private func releaseHoverCursor(at screenPoint: CGPoint) {
    let top = NSWindow.windowNumber(at: screenPoint, belowWindowWithWindowNumber: 0)
    if let other = NSApp.window(withWindowNumber: top), other !== window { return }
    PointerRole.passive.cursor.set()
  }
}

extension CapturePinnedWindow {
  func scheduleShadowInvalidation() {
    guard isShadowEnabled, !shadowInvalidationPending else { return }
    shadowInvalidationPending = true
    RunLoop.main.perform(inModes: [.default]) { [weak self] in
      MainActor.assumeIsolated {
        guard let self, self.shadowInvalidationPending else { return }
        self.shadowInvalidationPending = false
        guard !self.hasClosed, self.isShadowEnabled else { return }
        self.invalidateShadow()
      }
    }
  }
}
