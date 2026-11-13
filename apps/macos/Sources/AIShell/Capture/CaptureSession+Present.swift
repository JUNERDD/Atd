import AICore
import AppKit

/// What presenting a session found: when the displays were frozen (what the attachment reports
/// as `capturedAt`), the windows on screen before, and the field recorded in front.
struct CapturePresentation {
  let capturedAt: Date
  let snapshot: WindowSnapshot
  var target: ShortcutCommandEvent.Target?
}

extension CaptureSession {
  /// Freezes the displays (the cursor's first, each overlay shown as soon as its display is
  /// frozen), makes pointer and hover interaction live immediately, and transfers keyboard
  /// ownership once the invoking shortcut's keys are released (`needsHandoff`). `targetRead`
  /// updates the command row asynchronously without delaying presentation. An edit draws
  /// `reopening`'s image over the first display frozen and preselects it.
  func present(
    reopening: ReopenBase?, snapshot: WindowSnapshot, freezer: DisplayFreezer,
    targetRead: Task<ShortcutCommandEvent.Target?, Never>?, needsHandoff: Bool = true
  ) async throws -> CapturePresentation {
    arrange(quartzBounds: freezer.quartzBounds)
    let capturedAt = Date.now
    var preselection: (displayID: CGDirectDisplayID, rect: CGRect)?
    for target in freezer.targets {
      guard !isFinished else { break }
      guard var frozen = try await freezer.freeze(target) else { continue }
      if let reopening, preselection == nil {
        guard let composed = await reopening.compose(over: frozen) else {
          throw BridgeError("The screenshot could not be opened for editing.")
        }
        frozen = composed.display
        preselection = (frozen.displayID, composed.selection)
      }
      add(frozen, on: target.screen)
    }
    let presented = CapturePresentation(capturedAt: capturedAt, snapshot: snapshot, target: nil)
    // A display change or a quit may have ended the session meanwhile.
    if isFinished { return presented }
    guard !overlays.isEmpty else { throw BridgeError("No display could be captured.") }
    if let targetRead {
      targetTask = Task { [weak self] in
        let target = await targetRead.value
        guard !Task.isCancelled, let self, !self.isFinished else { return }
        self.applyWriteTarget(target)
      }
    }
    beginInteractive()
    if let reopening, let preselection {
      preselect(
        preselection.rect, onDisplay: preselection.displayID, restoring: reopening.document)
    }
    if needsHandoff {
      let sourcePID = NSWorkspace.shared.frontmostApplication?.processIdentifier
      handoffTask = Task { [weak self] in
        let released = await ShortcutRelease.waitForHandoff(isValid: { [weak self] in
          guard let self, !self.isFinished else { return false }
          return NSWorkspace.shared.frontmostApplication?.processIdentifier == sourcePID
        })
        guard !Task.isCancelled, let self, !self.isFinished else { return }
        guard released else {
          self.cancel()
          return
        }
        self.activateKeyboard()
      }
    } else {
      activateKeyboard()
    }
    return presented
  }

  /// Every display is frozen: pointer, hover and selection work immediately without activating
  /// the app or taking key status while the shortcut's keys are still held.
  func beginInteractive() {
    guard !isFinished else { return }
    isActive = true
    let mouse = NSEvent.mouseLocation
    let overlay =
      overlays.first { NSMouseInRect(mouse, $0.window?.frame ?? .zero, false) } ?? overlays.first
    guard let overlay, let window = overlay.window else { return }
    pointer = (overlay, overlay.convert(window.mouseLocationOutsideOfEventStream, from: nil))
    refreshBars()
    renderIdle()
    requestHover()
    overlay.refreshCursor()
  }

  /// Takes keyboard ownership once the invoking shortcut's keys are released, preserving any
  /// descendant responder an early selection commit already focused.
  func activateKeyboard() {
    guard !isFinished else { return }
    for overlay in overlays {
      (overlay.window as? CaptureOverlayPanel)?.allowsKey = true
    }
    hasKeyboard = true
    NSApp.activate()
    let target: CaptureOverlayView? =
      switch phase {
      case .selected(let rect), .longScreenshot(let rect),
        .adjusting(.move(_, let rect)), .adjusting(.resize(_, let rect)):
        primaryOverlay(for: rect) ?? pointer?.overlay ?? overlays.first
      case .pressing(let owner, _):
        owner
      case .idle, .creating, .adjusting(.create):
        pointer?.overlay ?? overlays.first
      }
    guard let overlay = target, let window = overlay.window else { return }
    window.makeKeyAndOrderFront(nil)
    if !((window.firstResponder as? NSView)?.isDescendant(of: overlay) ?? false) {
      window.makeFirstResponder(overlay)
    }
    switch phase {
    case .idle, .selected, .longScreenshot:
      overlay.refreshCursor()
    case .pressing, .creating, .adjusting:
      break
    }
  }

  /// Updates the command row's write-target state once the background AX read finishes.
  func applyWriteTarget(_ target: ShortcutCommandEvent.Target?) {
    guard options.commands != nil else { return }
    options.commands?.cursor = target?.writable == true
    options.commands?.cursorApp = target?.app
    editor?.commandRow = options.commands
  }

  /// Edit mode: makes `rect` (view points of the display `displayID`) the selection and puts
  /// `document` (selection-local) back on it, still editable.
  func preselect(
    _ rect: CGRect, onDisplay displayID: CGDirectDisplayID, restoring document: AnnotationDocument
  ) {
    guard !isFinished, let owner = overlays.first(where: { $0.display.displayID == displayID })
    else { return }
    if let window = owner.window {
      if hasKeyboard { window.makeKeyAndOrderFront(nil) }
      window.makeFirstResponder(owner)
      pointer = (owner, owner.convert(window.mouseLocationOutsideOfEventStream, from: nil))
    }
    commit(rect.offsetBy(dx: owner.bounds.minX, dy: owner.bounds.minY))
    if !document.isEmpty { editor?.restore(document) }
    owner.refreshCursor()
  }
}
