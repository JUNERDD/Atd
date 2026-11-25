import AICore
import AppKit

/// The session's input (decisions D8, D14): the pointer offers areas, a click commits one, a
/// drag selects freely, and a committed selection resizes from its handles and edge band at any
/// time, moves from inside until a tool claims the interior, and confirms. Points are desktop
/// points. A drag keeps reaching the overlay it began on wherever the pointer goes, so a
/// selection is drawn, moved or resized across displays from any of them. Overlays take first
/// mouse and track the pointer while inactive, so pointer input before ``activate()`` (the
/// displays still freezing) is dropped here: a press then would commit a selection reaching
/// displays whose overlays, and so whose canvases, do not exist yet.
extension CaptureSession: CaptureOverlayDelegate {
  /// A second screenshot shortcut copies a settled screenshot selection, or the long screenshot
  /// being captured without its result card. The same copy paths commit open annotation text
  /// and let ScreenshotTaker own the clipboard claim.
  func copyFromShortcut() {
    guard isActive, !isFinished, !choosingSaveDestination, mode == .screenshot else { return }
    switch phase {
    case .selected:
      if dismissOverlayPopovers() || editor?.dismissMenus() == true { return }
      copy(trigger: .repeatShortcut)
    case .longScreenshot:
      finishLongScreenshot(action: .copy, trigger: .repeatShortcut)
    case .idle, .pressing, .creating, .adjusting:
      return
    }
  }

  func overlay(_ overlay: CaptureOverlayView, pointerAt point: CGPoint) {
    guard isActive else { return }
    pointer = (overlay, point)
    guard case .idle = phase else { return }
    // While nothing is selected the keyboard follows the pointer's display.
    if hasKeyboard, let window = overlay.window, !window.isKeyWindow {
      window.makeKey()
      window.makeFirstResponder(overlay)
    }
    renderIdle()
    requestHover()
  }

  func overlay(
    _ overlay: CaptureOverlayView, mouseDownAt point: CGPoint, clickCount: Int,
    timestamp: TimeInterval
  ) {
    // An open menu of the record bar takes the presses outside it.
    guard isActive, accessory?.isModal != true else {
      confirmDoubleClick.disarm()
      return
    }
    switch phase {
    case .idle:
      confirmDoubleClick.disarm()
      phase = .pressing(overlay, start: point)
      refreshBars()
    case .selected(let rect):
      // Outside the selection a press does nothing; a right-click starts over instead, so a
      // stray click cannot lose the selection.
      let drag = model.drag(startingAt: point, selection: rect)
      switch drag {
      case .create:
        confirmDoubleClick.disarm()
        return
      case .move:
        // The host routes a claimed interior to the editor; this only guards the contract.
        guard !interiorClaimed else {
          confirmDoubleClick.disarm()
          return
        }
        if confirmDoubleClick.beginPress(at: point, clickCount: clickCount, timestamp: timestamp) {
          confirm(trigger: .doubleClick)
          return
        }
      case .resize:
        confirmDoubleClick.disarm()
      }
      phase = .adjusting(drag)
    // The long screenshot's selection is the app's; a press around it does nothing.
    case .pressing, .creating, .adjusting, .longScreenshot:
      confirmDoubleClick.disarm()
    }
  }

  func overlay(
    _ overlay: CaptureOverlayView, mouseDraggedTo point: CGPoint, constrained: Bool, centered: Bool
  ) {
    handleDragMoved(to: point, constrained: constrained, centered: centered)
  }

  func overlay(
    _ overlay: CaptureOverlayView, mouseUpAt point: CGPoint, constrained: Bool, centered: Bool,
    timestamp: TimeInterval
  ) {
    handleDragEnded(at: point, constrained: constrained, centered: centered, timestamp: timestamp)
  }

  func overlay(_ overlay: CaptureOverlayView, spacePanChanged active: Bool, at point: CGPoint) {
    updateSpacePan(active: active, at: point)
  }

  func overlayCanClickBadge(_ overlay: CaptureOverlayView) -> Bool {
    canClickBadge(on: overlay)
  }

  func overlay(_ overlay: CaptureOverlayView, didClickBadgeWith event: NSEvent) {
    confirmDoubleClick.disarm()
    editor?.disarmConfirmDoubleClick()
    showAspectMenu(on: overlay, with: event)
  }

  func overlayDidClickCornerBadge(_ overlay: CaptureOverlayView) {
    confirmDoubleClick.disarm()
    editor?.disarmConfirmDoubleClick()
  }

  /// Clears the selection back to idle, unless that would lose annotations (or open text),
  /// including the screenshot's while record mode shows.
  func overlayRightClicked(_ overlay: CaptureOverlayView) {
    guard isActive, case .selected = phase, editor?.hasAnnotations != true,
      shotDocument?.isEmpty ?? true, accessory?.isModal != true
    else { return }
    confirmDoubleClick.disarm()
    unhost()
    longScreenshot.resetSelection()
    aspectPreset = .free
    phase = .idle
    refreshBars()
    renderIdle()
    requestHover()
  }

  func overlay(_ overlay: CaptureOverlayView, perform command: CaptureCommand) {
    // The wheel walks the chain through here; keys cannot arrive before activation.
    guard isActive, !choosingSaveDestination else { return }
    confirmDoubleClick.disarm()
    editor?.disarmConfirmDoubleClick()
    // While the record bar's menu or folder panel is open the keyboard is its; Escape closes it.
    if accessory?.isModal == true {
      if command == .cancel { _ = accessory?.dismissMenus() }
      return
    }
    if case .longScreenshot = phase { return performInLongScreenshot(command) }
    switch command {
    case .cancel:
      longScreenshot.startWhenReady = false
      // Escape steps the editor back (an open menu or field, a running text command, a result
      // card, text mode) before it ends the session; it arrives here too from a field the
      // canvas does not hold, such as a result card's.
      if dismissOverlayPopovers() || editor?.stepBack() == true || accessory?.dismissMenus() == true
      {
        return
      }
      cancel()
    case .confirm:
      if dismissOverlayPopovers() || editor?.dismissMenus() == true { return }
      confirm(trigger: .returnKey)
    case .walk(let step):
      walkChain(step)
    case .selectDisplay:
      selectDisplay(on: overlay)
    // Arrows reach the session whenever the editor did not take them (it takes them only to
    // nudge a selected annotation). A held arrow repeats, so the text is read once it stops.
    case .nudge(let dx, let dy):
      guard case .selected(let rect) = phase else { return }
      move(to: model.nudged(rect, dx: dx, dy: dy), readAfter: CaptureTextReader.settleDelay)
    case .resize(let dWidth, let dHeight):
      guard case .selected(let rect) = phase else { return }
      move(
        to: model.resized(rect, dWidth: dWidth, dHeight: dHeight),
        readAfter: CaptureTextReader.settleDelay)
    case .resizeLeading(let dx, let dy):
      guard case .selected(let rect) = phase else { return }
      move(
        to: model.resizedLeading(rect, dx: dx, dy: dy), readAfter: CaptureTextReader.settleDelay)
    case .recall:
      recallRegion()
    case .toggleWindowsOnly:
      toggleWindowsOnly()
    case .mode(let mode):
      setMode(mode)
    case .requestAccessibility:
      requestAccessibility()
    case .longScreenshot:
      if offersLongScreenshot, case .selected = phase {
        startLongScreenshot()
      } else {
        self.overlay(overlay, perform: .nudge(dx: 0, dy: 1))
      }
    case .toggleAutoScroll:
      break
    case .save:
      guard !options.reopening, mode == .screenshot, case .selected = phase else { return }
      if dismissOverlayPopovers() || editor?.dismissMenus() == true { return }
      save(trigger: .commandShortcut)
    case .pin:
      guard mode == .screenshot, case .selected = phase else { return }
      if dismissOverlayPopovers() || editor?.dismissMenus() == true { return }
      pin(trigger: .commandShortcut)
    case .copyColor(let asRGB):
      _ = overlays.first(where: { $0.isLoupeVisible })?.copyLoupeColor(asRGB: asRGB)
    }
  }

  /// The selection's cursors (D15, `CaptureCursors.swift`): nil inside an interior a tool claimed,
  /// where the editor's canvas sets its own.
  func overlay(_ overlay: CaptureOverlayView, cursorAt point: CGPoint) -> NSCursor? {
    switch phase {
    case .selected(let rect):
      if let handle = model.handle(at: point, of: rect) { return handle.cursor }
      guard rect.contains(point) else { return PointerRole.passive.cursor }
      if interiorClaimed || editor?.claimsPress(at: point) == true { return nil }
      return PointerRole.grab.cursor
    case .adjusting(.move):
      return PointerRole.grabbing.cursor
    case .adjusting(.resize(let handle, _)):
      return handle.cursor
    case .adjusting:
      return PointerRole.passive.cursor
    case .idle, .pressing, .creating:
      return .crosshair
    case .longScreenshot(let rect):
      return longScreenshotCursor(at: point, selection: rect)
    }
  }

  // MARK: Selection

  /// Select All grows the selection a step: idle, to the display under the pointer (the
  /// keyboard follows it); with a selection, to the display holding most of it, and once it is
  /// that display, to every display. Annotations stay where they are (D14). A selection being
  /// dragged is left alone.
  private func selectDisplay(on overlay: CaptureOverlayView) {
    switch phase {
    case .idle:
      commit(model.settled((pointer?.overlay ?? overlay).bounds))
    case .selected(let rect):
      let display = wholeDisplay(holding: rect, fallback: overlay.bounds)
      move(to: rect == display ? model.settled(model.bounds) : display)
    case .pressing, .creating, .adjusting, .longScreenshot:
      break
    }
  }

  /// Makes `rect` the selection and hosts the mode on it (``host(_:)``): the annotation editor,
  /// whose canvas covers every display it reaches, or the record bar. A click on a detected
  /// element sets ``CaptureSession/pick`` once this returns.
  func commit(_ rect: CGRect) {
    confirmDoubleClick.disarm()
    phase = .selected(rect)
    pick = nil
    interiorClaimed = false
    showLoupe(at: nil)
    show(rect, handles: true)
    refreshBars()
    host(rect)
    if hasKeyboard { primaryOverlay(for: rect)?.window?.makeKey() }
  }

  /// Whether a press at `point` is the session's rather than the editor's (D14): the handles
  /// and the edge band always, the interior until a tool or text mode claims it, except where
  /// the editor claims a press of its own there (``AnnotationEditing/claimsPress(at:)``).
  func ownsPress(at point: CGPoint) -> Bool {
    guard case .selected(let rect) = phase else { return false }
    if model.handle(at: point, of: rect) != nil { return true }
    return !interiorClaimed && rect.contains(point) && editor?.claimsPress(at: point) != true
  }

  /// A settled move or resize: the bar takes its place for the new selection first, so the bars
  /// beside the selection keep clear of where it now is; the text is read again, and the scroll
  /// area under it looked for, once no other move came for `delay`.
  func move(to rect: CGRect, readAfter delay: Duration = .zero) {
    confirmDoubleClick.disarm()
    phase = .selected(rect)
    showLoupe(at: nil)
    show(rect, handles: true)
    refreshBars()
    follow(rect)
    if hasKeyboard, !overlays.contains(where: { $0.window?.firstResponder is NSTextView }) {
      for overlay in overlays {
        if let canvas = overlay.annotationHost.canvas, overlay.window?.firstResponder !== canvas {
          overlay.window?.makeFirstResponder(canvas)
        }
      }
      if let window = primaryOverlay(for: rect)?.window, !window.isKeyWindow {
        window.makeKey()
      }
    }
    readText(in: rect, after: delay)
    probeScrollArea(in: rect, after: delay)
  }

  /// The editor's bars or the record bar follow `rect`, clear of the bottom bar where it is and
  /// of the size label, holding their place while the mouse still drags it.
  func follow(_ rect: CGRect) {
    editor?.keepClear = keepClear(for: rect)
    editor?.selectionDidChange(rect, dragging: isAdjusting)
    placeAccessory(beside: rect)
  }

  /// Dismisses any overlay-owned popovers (such as the corner-radius popover); returns true when
  /// at least one popover was closed.
  @discardableResult
  func dismissOverlayPopovers() -> Bool {
    var dismissed = false
    for overlay in overlays where overlay.hasOpenCornerPopover {
      overlay.dismissCornerPopover()
      dismissed = true
    }
    return dismissed
  }

  /// Orders out `NSColorPanel.shared` if a capture popover opened and elevated it above overlays.
  func closeOwnedColorPanel() {
    guard NSColorPanel.sharedColorPanelExists else { return }
    let colorPanel = NSColorPanel.shared
    if colorPanel.isVisible, colorPanel.level.rawValue >= ToolbarWindow.aboveCapture.rawValue {
      colorPanel.orderOut(nil)
    }
  }
}
