import AICore
import AppKit

/// The session's input (decisions D8, D14): the pointer offers areas, a click commits one, a
/// drag selects freely, and a committed selection resizes from its handles and edge band at any
/// time, moves from inside until a tool claims the interior, and confirms. Points are desktop
/// points. A drag keeps reaching the overlay it began on wherever the pointer goes, so a
/// selection is drawn, moved or resized across displays from any of them.
extension CaptureSession: CaptureOverlayDelegate {
  func overlay(_ overlay: CaptureOverlayView, pointerAt point: CGPoint) {
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
    switch phase {
    case .idle:
      if isTrustRequest(point, on: overlay) {
        finish(.wantsAccessibility)
      } else {
        phase = .pressing(overlay, start: point)
      }
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
    case .pressing, .creating, .adjusting:
      break
    }
  }

  func overlay(_ overlay: CaptureOverlayView, mouseDraggedTo point: CGPoint, square: Bool) {
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
      editor?.selectionDidChange(rect)
    case .idle, .selected:
      break
    }
  }

  func overlay(_ overlay: CaptureOverlayView, mouseUpAt point: CGPoint, square: Bool) {
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
    case .idle, .selected:
      break
    }
  }

  /// Clears the selection back to idle, unless that would lose annotations (or open text).
  func overlayRightClicked(_ overlay: CaptureOverlayView) {
    guard case .selected = phase, editor?.hasAnnotations != true else { return }
    editor?.hide()
    editor = nil
    interiorClaimed = false
    for overlay in overlays {
      overlay.annotationHost.passThrough = nil
      overlay.annotationHost.scroll = nil
    }
    phase = .idle
    refreshHints()
    renderIdle()
    requestHover()
  }

  func overlay(_ overlay: CaptureOverlayView, perform command: CaptureCommand) {
    switch command {
    case .cancel:
      cancel()
    case .confirm:
      confirm()
    case .walk(let step):
      walkChain(step)
    case .selectDisplay:
      selectDisplay(on: overlay)
    // Arrows reach the session whenever the editor did not take them (it takes them only to
    // nudge a selected annotation).
    case .nudge(let dx, let dy):
      guard case .selected(let rect) = phase else { return }
      move(to: model.nudged(rect, dx: dx, dy: dy))
    case .resize(let dWidth, let dHeight):
      guard case .selected(let rect) = phase else { return }
      move(to: model.resized(rect, dWidth: dWidth, dHeight: dHeight))
    case .resizeLeading(let dx, let dy):
      guard case .selected(let rect) = phase else { return }
      move(to: model.resizedLeading(rect, dx: dx, dy: dy))
    case .recall:
      recallRegion()
    case .toggleWindowsOnly:
      toggleWindowsOnly()
    }
  }

  /// The selection's cursors (D15, `CaptureCursors.swift`): nil inside an interior a tool claimed,
  /// where the editor's canvas sets its own.
  func overlay(_ overlay: CaptureOverlayView, cursorAt point: CGPoint) -> NSCursor? {
    switch phase {
    case .selected(let rect):
      if let handle = model.handle(at: point, of: rect) { return handle.cursor }
      guard rect.contains(point) else { return .arrow }
      return interiorClaimed ? nil : .openHand
    case .adjusting(.move):
      return .closedHand
    case .adjusting(.resize(let handle, _)):
      return handle.cursor
    case .adjusting:
      return .arrow
    case .idle, .pressing, .creating:
      return .crosshair
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
      let display = model.settled(primaryOverlay(for: rect)?.bounds ?? overlay.bounds)
      move(to: rect == display ? model.settled(model.bounds) : display)
    case .pressing, .creating, .adjusting:
      break
    }
  }

  /// Makes `rect` the selection and hands it to a new annotation editor, whose canvas covers
  /// every display it reaches. A click on a detected element sets ``CaptureSession/pick`` once
  /// this returns.
  func commit(_ rect: CGRect) {
    phase = .selected(rect)
    pick = nil
    interiorClaimed = false
    showLoupe(at: nil)
    refreshHints()
    show(rect, handles: true)
    let editor = makeEditor()
    self.editor = editor
    editor.onConfirm = { [weak self] in self?.confirm() }
    editor.onCancel = { [weak self] in self?.cancel() }
    editor.onCopy = { [weak self] in self?.copy() }
    editor.onInteriorClaimChange = { [weak self] claimed in
      guard let self else { return }
      interiorClaimed = claimed
      for overlay in overlays { overlay.refreshCursor() }
    }
    editor.elementTargets = { [weak self] point in
      await self?.elementTargets(at: point) ?? []
    }
    for overlay in overlays {
      overlay.annotationHost.passThrough = { [weak self] in self?.ownsPress(at: $0) ?? false }
      overlay.annotationHost.scroll = { [weak editor] in editor?.scroll($0) ?? false }
    }
    editor.show(in: overlays.map(\.annotationHost), selection: rect) { [weak self] in
      self?.desktop.backdrop(for: $0)
    }
    primaryOverlay(for: rect)?.window?.makeKey()
  }

  /// Whether a press at `point` is the session's rather than the editor's (D14): the handles
  /// and the edge band always, the interior until a tool claims it.
  private func ownsPress(at point: CGPoint) -> Bool {
    guard case .selected(let rect) = phase else { return false }
    if model.handle(at: point, of: rect) != nil { return true }
    return !interiorClaimed && rect.contains(point)
  }

  private func move(to rect: CGRect) {
    phase = .selected(rect)
    showLoupe(at: nil)
    show(rect, handles: true)
    editor?.selectionDidChange(rect)
    refreshHints()
  }

  private func showCreating(_ drag: SelectionDrag, at point: CGPoint, square: Bool) {
    show(model.rect(for: drag, to: point, square: square), handles: false)
    showLoupe(at: model.clamped(point))
  }
}
