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
    guard isActive, !isFinished, mode == .screenshot else { return }
    switch phase {
    case .selected:
      if editor?.dismissMenus() == true { return }
      copy()
    case .longScreenshot:
      finishLongScreenshot(copying: true)
    case .idle, .pressing, .creating, .adjusting:
      return
    }
  }

  func overlay(_ overlay: CaptureOverlayView, pointerAt point: CGPoint) {
    guard isActive else { return }
    pointer = (overlay, point)
    guard case .idle = phase else { return }
    // While nothing is selected the keyboard follows the pointer's display.
    if let window = overlay.window, !window.isKeyWindow {
      window.makeKey()
      window.makeFirstResponder(overlay)
    }
    renderIdle()
    requestHover()
  }

  func overlay(_ overlay: CaptureOverlayView, mouseDownAt point: CGPoint, clickCount: Int) {
    // An open menu of the record bar takes the presses outside it.
    guard isActive, accessory?.isModal != true else { return }
    switch phase {
    case .idle:
      phase = .pressing(overlay, start: point)
      refreshBars()
    case .selected(let rect):
      // Outside the selection a press does nothing; a right-click starts over instead, so a
      // stray click cannot lose the selection.
      let drag = model.drag(startingAt: point, selection: rect)
      switch drag {
      case .create:
        return
      case .move:
        // The host routes a claimed interior to the editor; this only guards the contract.
        guard !interiorClaimed else { return }
        if clickCount >= 2 {
          confirm()
          return
        }
      case .resize:
        break
      }
      phase = .adjusting(drag)
    // The long screenshot's selection is the app's; a press around it does nothing.
    case .pressing, .creating, .adjusting, .longScreenshot:
      break
    }
  }

  func overlay(_ overlay: CaptureOverlayView, mouseDraggedTo point: CGPoint, square: Bool) {
    guard isActive else { return }
    switch phase {
    case .pressing(_, let start):
      guard !SelectionModel.isClick(from: start, to: point) else { return }
      let drag = SelectionDrag.create(origin: model.clamped(start))
      phase = .creating(drag)
      showCreating(drag, at: point, square: square)
    case .creating(let drag):
      showCreating(drag, at: point, square: square)
    case .adjusting(let drag):
      let rect = model.rect(for: drag, to: point)
      show(rect, handles: true)
      // The loupe shows the pixel being adjusted until the button goes up (`move`).
      showLoupe(at: model.loupePoint(for: drag, rect: rect, pointer: point))
      follow(rect)
    case .idle, .selected, .longScreenshot:
      break
    }
  }

  func overlay(_ overlay: CaptureOverlayView, mouseUpAt point: CGPoint, square: Bool) {
    guard isActive else { return }
    switch phase {
    case .pressing(let owner, let start):
      let selection = model.settled(offeredArea(on: owner))
      let pick = pickedElement(at: start, on: owner, selection: selection)
      commit(selection)
      self.pick = pick
    case .creating(let drag):
      commit(model.rect(for: drag, to: point, square: square))
    case .adjusting(let drag):
      move(to: model.rect(for: drag, to: point))
    case .idle, .selected, .longScreenshot:
      break
    }
  }

  /// Clears the selection back to idle, unless that would lose annotations (or open text),
  /// including the screenshot's while record mode shows.
  func overlayRightClicked(_ overlay: CaptureOverlayView) {
    guard isActive, case .selected = phase, editor?.hasAnnotations != true,
      shotDocument?.isEmpty ?? true, accessory?.isModal != true
    else { return }
    unhost()
    phase = .idle
    refreshBars()
    renderIdle()
    requestHover()
  }

  func overlay(_ overlay: CaptureOverlayView, perform command: CaptureCommand) {
    // The wheel walks the chain through here; keys cannot arrive before activation.
    guard isActive else { return }
    // While the record bar's menu or folder panel is open the keyboard is its; Escape closes it.
    if accessory?.isModal == true {
      if command == .cancel { _ = accessory?.dismissMenus() }
      return
    }
    if case .longScreenshot = phase { return performInLongScreenshot(command) }
    switch command {
    case .cancel:
      // Escape closes an open menu or the ask field before it ends the session.
      if editor?.dismissMenus() == true || accessory?.dismissMenus() == true { return }
      cancel()
    case .confirm:
      if editor?.dismissMenus() == true { return }
      confirm()
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
      // Only a screenshot selection takes ⌘↓, beeping while it does not offer the long
      // screenshot; where the session never offers it, ⌘↓ stays the nudge it was.
      if offersLongScreenshot, case .selected = phase {
        startLongScreenshot()
      } else {
        self.overlay(overlay, perform: .nudge(dx: 0, dy: 1))
      }
    case .toggleAutoScroll:
      break
    }
  }

  /// The selection's cursors (D15, `CaptureCursors.swift`): nil inside an interior a tool claimed,
  /// where the editor's canvas sets its own.
  func overlay(_ overlay: CaptureOverlayView, cursorAt point: CGPoint) -> NSCursor? {
    switch phase {
    case .selected(let rect):
      if let handle = model.handle(at: point, of: rect) { return handle.cursor }
      guard rect.contains(point) else { return .arrow }
      if interiorClaimed { return nil }
      return .openHand
    case .adjusting(.move):
      return .closedHand
    case .adjusting(.resize(let handle, _)):
      return handle.cursor
    case .adjusting:
      return .arrow
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
    phase = .selected(rect)
    pick = nil
    interiorClaimed = false
    showLoupe(at: nil)
    show(rect, handles: true)
    refreshBars()
    host(rect)
    primaryOverlay(for: rect)?.window?.makeKey()
  }

  /// Whether a press at `point` is the session's rather than the editor's (D14): the handles
  /// and the edge band always, the interior until a tool claims it.
  func ownsPress(at point: CGPoint) -> Bool {
    guard case .selected(let rect) = phase else { return false }
    if model.handle(at: point, of: rect) != nil { return true }
    return !interiorClaimed && rect.contains(point)
  }

  /// A settled move or resize: the bar takes its place for the new selection first, so the bars
  /// beside the selection keep clear of where it now is; the text is read again, and the scroll
  /// area under it looked for, once no other move came for `delay`.
  private func move(to rect: CGRect, readAfter delay: Duration = .zero) {
    phase = .selected(rect)
    showLoupe(at: nil)
    show(rect, handles: true)
    refreshBars()
    follow(rect)
    readText(in: rect, after: delay)
    probeScrollArea(in: rect, after: delay)
  }

  /// The editor's bars or the record bar follow `rect`, clear of the bottom bar where it is and
  /// of the size label, holding their place while the mouse still drags it.
  private func follow(_ rect: CGRect) {
    editor?.keepClear = keepClear(for: rect)
    editor?.selectionDidChange(rect, dragging: isAdjusting)
    placeAccessory(beside: rect)
  }

  private func showCreating(_ drag: SelectionDrag, at point: CGPoint, square: Bool) {
    show(model.rect(for: drag, to: point, square: square), handles: false)
    showLoupe(at: model.clamped(point))
  }
}
