import AICore
import AppKit

/// `screenshot.capture` and `screenshot.edit`: the native capture session (decisions D6–D11,
/// F1–F3). It freezes every display, lets the user pick and annotate an area on the overlays,
/// and imports the result through ``CaptureLibrary`` like a picked file. Editing reopens an
/// earlier screenshot over the frozen screen under the pointer, preselected and annotatable;
/// the result is a new attachment. Copying instead puts the same result on the clipboard and
/// attaches nothing, so the page's call answers `cancelled`.
///
/// Around the session it owns the app's state: the panel is withdrawn and later restored as it
/// was, the app is activated for the overlays (cursor, keyboard, input methods) and hands
/// activation back to the app that was frontmost before.
final class ScreenshotTaker {
  /// How a session ended, for the two calls to answer in their own result types.
  private enum SessionEnd {
    /// Also a copy: the page gets nothing to attach either way.
    case cancelled
    case notPermitted
    case confirmed(CaptureConfirmation, capturedAt: Date, snapshot: WindowSnapshot)
  }

  private let library: CaptureLibrary
  private let panel: PanelWindowController
  private let targeting: any ElementTargeting
  /// Where the Screen Recording prompt is asked, once per launch.
  private let access: ScreenRecordingTrust
  private let makeEditor: @MainActor () -> any AnnotationEditing
  /// The running session; a quit or a display change ends it through ``cancel()``.
  private var session: CaptureSession?
  /// One capture or edit at a time: a second call is refused rather than queued, because each
  /// call starts an interactive session the user would otherwise face twice.
  private(set) var isCapturing = false {
    didSet { if isCapturing != oldValue { onCapturingChange?(isCapturing) } }
  }
  /// Told when a capture or edit starts and ends; the mini panel leaves the screen meanwhile, so
  /// it is in no frozen image and never over the overlays.
  var onCapturingChange: ((_ capturing: Bool) -> Void)?
  /// macOS shows the Accessibility hint's prompt once per app; asking again within a launch would
  /// only reopen System Settings uninvited. (The Screen Recording prompt follows the same rule in
  /// ``ScreenRecordingTrust``.)
  private var trustRequested = false
  /// The last confirmed capture per display, which `R` selects again in later sessions.
  private var regions = CaptureRegionMemory()

  init(
    library: CaptureLibrary, panel: PanelWindowController, targeting: any ElementTargeting,
    access: ScreenRecordingTrust, makeEditor: @escaping @MainActor () -> any AnnotationEditing
  ) {
    self.library = library
    self.panel = panel
    self.targeting = targeting
    self.access = access
    self.makeEditor = makeEditor
  }

  /// Ends a running session as if the user pressed Escape; the page's call answers
  /// `cancelled`.
  func cancel() { session?.cancel() }

  func capture() async throws(BridgeError) -> ScreenshotCaptureResult {
    try claim()
    defer { isCapturing = false }
    switch try await runSession(reopening: nil) {
    case .cancelled:
      return .notOk(.init(reason: .cancelled))
    case .notPermitted:
      return .notOk(.init(reason: .notPermitted))
    case .confirmed(let capture, let capturedAt, let snapshot):
      regions.remember(
        capture.selection, displayID: capture.displayID, displayFrame: capture.displayFrame)
      let imported = try await library.importCapture(
        capture, capturedAt: capturedAt, snapshot: snapshot)
      return .ok(
        .init(
          file: imported.file, context: imported.context,
          capturedAt: CapturedText.timestamp(capturedAt)))
    }
  }

  /// Reopens `resourceId` for editing. The base image is ready before anything is shown, so
  /// a download that fails rejects the call without a session.
  func edit(resourceId: String) async throws(BridgeError) -> ScreenshotEditResult {
    try claim()
    defer { isCapturing = false }
    guard CGPreflightScreenCaptureAccess() else {
      requestScreenAccess()
      return .notOk(.init(reason: .notPermitted))
    }
    let base = try await library.base(for: resourceId)
    switch try await runSession(reopening: base) {
    case .cancelled:
      return .notOk(.init(reason: .cancelled))
    case .notPermitted:
      return .notOk(.init(reason: .notPermitted))
    case .confirmed(let capture, let capturedAt, _):
      let imported = try await library.importCapture(
        capture, capturedAt: capturedAt, snapshot: nil)
      return .ok(
        .init(file: imported.file, context: nil, capturedAt: CapturedText.timestamp(capturedAt)))
    }
  }

  private func claim() throws(BridgeError) {
    guard !isCapturing else { throw BridgeError("A screenshot is already being taken.") }
    isCapturing = true
  }

  /// One session from the panel's withdrawal to its return. Detection runs only for a new
  /// capture; an edit opens with `reopening` preselected instead.
  private func runSession(reopening: ReopenBase?) async throws(BridgeError) -> SessionEnd {
    // A build whose grant was revoked (a new ad hoc signature) captures only the wallpaper and
    // the menu bar, so the grant is checked on every capture before anything is shown.
    guard CGPreflightScreenCaptureAccess() else {
      requestScreenAccess()
      return .notPermitted
    }
    let previousApp = NSWorkspace.shared.frontmostApplication.flatMap {
      $0 == NSRunningApplication.current ? nil : $0
    }
    let restorePanel = panel.withdrawForCapture()
    let session = CaptureSession(
      targeting: targeting, offersTrustRequest: !trustRequested,
      regions: reopening == nil ? regions : CaptureRegionMemory(), makeEditor: makeEditor)
    self.session = session
    defer { self.session = nil }
    let presented: (capturedAt: Date, snapshot: WindowSnapshot)
    do {
      presented = try await present(session, reopening: reopening)
    } catch {
      session.cancel()
      _ = await session.run()
      restorePanel()
      if DisplayFreezer.isPermissionError(error) {
        requestScreenAccess()
        return .notPermitted
      }
      throw (error as? BridgeError) ?? BridgeError("The screen could not be captured.")
    }
    let outcome = await session.run()
    // The previous app gets activation back before the panel reappears, so a restored panel
    // is key over it exactly as before (non-activating, like a summon).
    if NSApp.isActive, let previousApp { _ = previousApp.activate(from: .current, options: []) }
    restorePanel()
    switch outcome {
    case .cancelled:
      return .cancelled
    case .wantsAccessibility:
      trustRequested = true
      SelectionReader.requestTrust()
      return .cancelled
    case .failed:
      throw BridgeError("The screenshot could not be prepared.")
    case .confirmed(let capture):
      return .confirmed(capture, capturedAt: presented.capturedAt, snapshot: presented.snapshot)
    case .copied(let capture):
      if reopening == nil {
        regions.remember(
          capture.selection, displayID: capture.displayID, displayFrame: capture.displayFrame)
      }
      Self.copy(capture)
      return .cancelled
    }
  }

  /// Puts the annotated screenshot on the general pasteboard at the display's full pixel size,
  /// as PNG and TIFF (what most apps read), sized in points so it pastes at screen size.
  private static func copy(_ capture: CaptureConfirmation) {
    let image = NSBitmapImageRep(cgImage: capture.image)
    image.size = NSSize(
      width: CGFloat(capture.image.width) / capture.pixelScale,
      height: CGFloat(capture.image.height) / capture.pixelScale)
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.declareTypes([.png, .tiff], owner: nil)
    if let png = image.representation(using: .png, properties: [:]) {
      pasteboard.setData(png, forType: .png)
    }
    if let tiff = image.tiffRepresentation { pasteboard.setData(tiff, forType: .tiff) }
  }

  /// Takes the window snapshot (new captures only), freezes the displays (the cursor's first,
  /// each overlay shown as soon as its display is frozen) and activates the app. An edit draws
  /// its image over the first display frozen and preselects it. Returns the freeze time, which
  /// the attachment reports as `capturedAt`.
  private func present(_ session: CaptureSession, reopening: ReopenBase?) async throws -> (
    capturedAt: Date, snapshot: WindowSnapshot
  ) {
    // Before any overlay exists: detection must see the windows the user sees.
    let snapshot = reopening == nil ? WindowSnapshot.take() : WindowSnapshot(entries: [])
    if reopening == nil { session.begin(windows: snapshot.windows) }
    let freezer = try await DisplayFreezer.prepare()
    let capturedAt = Date.now
    var preselection: (displayID: CGDirectDisplayID, rect: CGRect)?
    for target in freezer.targets {
      guard !session.isFinished else { break }
      guard var frozen = try await freezer.freeze(target) else { continue }
      if let reopening, preselection == nil {
        guard let composed = await reopening.compose(over: frozen) else {
          throw BridgeError("The screenshot could not be opened for editing.")
        }
        frozen = composed.display
        preselection = (frozen.displayID, composed.selection)
      }
      session.add(frozen, on: target.screen)
    }
    // A display change or a quit may have ended the session meanwhile.
    if session.isFinished { return (capturedAt, snapshot) }
    guard !session.overlays.isEmpty else { throw BridgeError("No display could be captured.") }
    // Activating only now keeps the other displays' windows in their active appearance while
    // they are frozen.
    NSApp.activate()
    session.activate()
    if let reopening, let preselection {
      session.preselect(
        preselection.rect, onDisplay: preselection.displayID, restoring: reopening.document)
    }
    return (capturedAt, snapshot)
  }

  /// Asks for Screen Recording (once per launch), for a call that answers `notPermitted`.
  private func requestScreenAccess() {
    access.prompt()
  }
}
