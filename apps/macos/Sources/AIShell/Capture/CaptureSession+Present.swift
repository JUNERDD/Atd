import AICore
import AppKit

/// What presenting a session found: when the displays were frozen (what the attachment reports
/// as `capturedAt`), the windows on screen before, and the field recorded in front.
struct CapturePresentation {
  let capturedAt: Date
  let snapshot: WindowSnapshot
  let target: ShortcutCommandEvent.Target?
}

extension CaptureSession {
  /// Takes the window snapshot (new captures only), freezes the displays (the cursor's first,
  /// each overlay shown as soon as its display is frozen) and activates the app, once
  /// `targetRead` has read the field in front. An edit draws `reopening`'s image over the first
  /// display frozen and preselects it.
  func present(
    reopening: ReopenBase?, targetRead: Task<ShortcutCommandEvent.Target?, Never>?
  ) async throws -> CapturePresentation {
    // Before any overlay exists: detection must see the windows the user sees.
    let snapshot = reopening == nil ? WindowSnapshot.take() : WindowSnapshot(entries: [])
    longScreenshot.snapshot = snapshot
    if reopening == nil { begin(windows: snapshot.windows) }
    let freezer = try await DisplayFreezer.prepare()
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
    let target = await targetRead?.value
    options.commands?.cursor = target?.writable == true
    options.commands?.cursorApp = target?.app
    let presented = CapturePresentation(capturedAt: capturedAt, snapshot: snapshot, target: target)
    // A display change or a quit may have ended the session meanwhile.
    if isFinished { return presented }
    guard !overlays.isEmpty else { throw BridgeError("No display could be captured.") }
    guard await ShortcutRelease.waitForHandoff(isValid: { !isFinished }) else {
      cancel()
      return presented
    }
    // Activating only now keeps the other displays' windows in their active appearance while
    // they are frozen.
    NSApp.activate()
    activate()
    if let reopening, let preselection {
      preselect(
        preselection.rect, onDisplay: preselection.displayID, restoring: reopening.document)
    }
    return presented
  }
}
