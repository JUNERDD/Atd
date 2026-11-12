import AICore
import AppKit

/// One capture session as ``ScreenshotTaker`` runs it: what a request's session offers, the
/// session from the panel's withdrawal to its return, and its outcome in the calls' terms.
extension ScreenshotTaker {
  /// How a session went: refused before anything showed because Screen Recording is not
  /// granted, or ended with its outcome over what it presented.
  enum SessionRun {
    case notPermitted
    case ended(CaptureSession.Outcome, CapturePresentation)
  }

  /// What `request`'s session offers: an edit and a plain capture only annotate.
  func options(for request: ScreenshotRequest, reopening: ReopenBase?) -> CaptureSessionOptions {
    var options = CaptureSessionOptions()
    options.copyShortcut = copyShortcut()
    if reopening != nil { return options }
    options.canRecord = recorder != nil && request.toolbar
    options.mode = options.canRecord ? request.mode : .screenshot
    options.makeRecordAccessory = makeRecordAccessory
    guard request.toolbar else { return options }
    // A long screenshot goes to the island's result card; a caller waiting for an image gets none.
    options.offersLongScreenshot = true
    let arbiter = arbiter
    options.commands = CaptureCommandRowSetup(
      commands: toolbarCommands, catalog: commandOptions(),
      onPick: { [weak self] id, values in self?.onCommandOptionsPicked?(id, values) },
      copyText: { text in arbiter.writeClipboard(text, as: .screenshot) },
      openSettings: { [weak self] in
        self?.opensCommandSettings = true
        self?.session?.cancel()
      })
    options.commands?.textCommands = textCommands
    options.commands?.textRuns = textRuns
    options.commands?.copyImage = { image, scale in
      arbiter.writeClipboard(as: .screenshot) {
        CaptureExport.copy(image, pixelScale: scale, to: $0)
      }
    }
    return options
  }

  /// One session, in the calls' terms (``end(_:presented:editing:)``).
  func runSession(
    reopening: ReopenBase?, request: ScreenshotRequest, writeTargets: WriteTargets?
  ) async throws(BridgeError) -> SessionEnd {
    switch try await run(reopening: reopening, request: request, writeTargets: writeTargets) {
    case .notPermitted:
      return .notPermitted
    case .ended(let outcome, let presented):
      return try end(outcome, presented: presented, editing: reopening != nil)
    }
  }

  /// One session from the panel's withdrawal to its return. Detection runs only for a new
  /// capture; an edit opens with `reopening` preselected instead.
  func run(
    reopening: ReopenBase?, request: ScreenshotRequest, writeTargets: WriteTargets?
  ) async throws(BridgeError) -> SessionRun {
    // A build whose grant was revoked (or left with an earlier signature) captures only the
    // wallpaper and the menu bar, so the grant is checked on every capture before anything shows.
    guard CGPreflightScreenCaptureAccess() else {
      guard await ShortcutRelease.waitForHandoff() else {
        throw BridgeError("The screenshot was cancelled.")
      }
      requestScreenAccess()
      return .notPermitted
    }
    let previousApp = NSWorkspace.shared.frontmostApplication.flatMap {
      $0 == NSRunningApplication.current ? nil : $0
    }
    let restorePanel = panel.withdrawForCapture()
    // Before any overlay exists: detection must see the windows the user sees.
    let snapshot = reopening == nil ? WindowSnapshot.take() : WindowSnapshot(entries: [])
    let targetRead: Task<ShortcutCommandEvent.Target?, Never>?
    let session: CaptureSession
    defer { self.session = nil }
    var presented: CapturePresentation
    do {
      async let freezer = DisplayFreezer.prepare()
      // Read while the app in front still has its field focused; the freeze runs meanwhile.
      targetRead =
        request.toolbar
        ? writeTargets.map { targets in
          Task { await targets.capture(after: .unread) }
        } : nil
      session = CaptureSession(
        targeting: targeting, offersTrustRequest: !trustRequested,
        regions: reopening == nil ? regions : CaptureRegionMemory(),
        options: options(for: request, reopening: reopening), makeEditor: makeEditor)
      self.session = session
      session.longScreenshot.snapshot = snapshot
      if reopening == nil { session.begin(windows: snapshot.windows) }
      presented = try await session.present(
        reopening: reopening, snapshot: snapshot, freezer: try await freezer,
        targetRead: targetRead, needsHandoff: true)
    } catch {
      targetRead?.cancel()
      session.cancel()
      _ = await session.run()
      restorePanel()
      if DisplayFreezer.isPermissionError(error) {
        guard await ShortcutRelease.waitForHandoff() else {
          throw BridgeError("The screenshot was cancelled.")
        }
        requestScreenAccess()
        return .notPermitted
      }
      throw (error as? BridgeError) ?? BridgeError("The screen could not be captured.")
    }
    let outcome = await session.run()
    switch outcome {
    case .confirmed, .launched, .textResult(.insert):
      presented.target = await targetRead?.value
    case .cancelled, .wantsAccessibility, .failed, .copied, .record, .longScreenshot,
      .copiedLongScreenshot, .textResult(.open):
      targetRead?.cancel()
    }
    // The previous app gets activation back before the panel reappears, so a panel that had the
    // keyboard is key over it exactly as before (non-activating, like a summon), and one that
    // did not returns behind the windows that covered it.
    if NSApp.isActive, let previousApp { _ = previousApp.activate(from: .current, options: []) }
    restorePanel()
    // Auto-scroll was refused for its permission during the long screenshot.
    if session.longScreenshot.asksForTrust { requestTrust() }
    return .ended(outcome, presented)
  }

  /// The session's outcome as the calls see it: a record request gets the window and the app it
  /// shows from the snapshot, and its region is remembered like a confirmed one.
  private func end(
    _ outcome: CaptureSession.Outcome, presented: CapturePresentation, editing: Bool
  )
    throws(BridgeError) -> SessionEnd
  {
    func confirmed(_ capture: CaptureConfirmation, _ launch: CaptureLaunch?) -> SessionEnd {
      .confirmed(
        Confirmed(
          capture: capture, launch: launch, target: presented.target,
          capturedAt: presented.capturedAt, snapshot: presented.snapshot))
    }
    switch outcome {
    case .cancelled:
      return .cancelled
    case .wantsAccessibility:
      requestTrust()
      return .cancelled
    case .failed:
      throw BridgeError("The screenshot could not be prepared.")
    case .confirmed(let capture):
      return confirmed(capture, nil)
    case .launched(let capture, let launch):
      return confirmed(capture, launch)
    case .copied(let capture):
      if !editing {
        regions.remember(
          capture.selection, displayID: capture.displayID, displayFrame: capture.displayFrame)
      }
      arbiter.writeClipboard(as: .screenshot) { CaptureExport.copy(capture, to: $0) }
      return .cancelled
    case .record(let request):
      regions.remember(
        request.rect, displayID: request.displayID, displayFrame: request.displayFrame)
      let quartz = request.rect.offsetBy(
        dx: request.displayFrame.minX, dy: request.displayFrame.minY)
      let subject = presented.snapshot.subject(of: quartz)
      return .record(
        CaptureRecordRequest(
          displayID: request.displayID, displayFrame: request.displayFrame, rect: request.rect,
          windowID: subject.windowID, appName: subject.app, bundleID: subject.bundleID))
    case .longScreenshot(let shot):
      return .longScreenshot(shot)
    case .copiedLongScreenshot(let shot):
      return .copiedLongScreenshot(shot)
    case .textResult(let handoff):
      return .textResult(handoff)
    }
  }

  /// Puts a long screenshot copied from its live phase on the clipboard: the whole stitched
  /// image, as the result card's Copy puts an untouched one (PNG, with TIFF while it is not too
  /// large), encoded off the main actor and written under the screenshot's clipboard claim. A
  /// beep says it could not be.
  func copy(_ shot: LongScreenshotImage) {
    Task { [arbiter] in
      guard
        let clipboard = await CaptureExport.longScreenshotClipboard(shot.image, scale: shot.scale),
        arbiter.writeClipboard(as: .screenshot, { CaptureExport.copy(clipboard, to: $0) })
      else { return NSSound.beep() }
    }
  }

  /// Asks for Accessibility once the overlays are gone (their session offered the request only
  /// while none was made this launch, ``trustRequested``).
  private func requestTrust() {
    trustRequested = true
    SelectionReader.requestTrust()
  }
}
