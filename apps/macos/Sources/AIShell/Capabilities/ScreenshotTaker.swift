import AICore
import AppKit

/// `screenshot.capture` and `screenshot.edit`: the native capture session (decisions D6–D11,
/// F1–F3). It freezes every display, lets the user pick and annotate an area on the overlays,
/// and imports the result through ``CaptureLibrary`` like a picked file. Editing reopens an
/// earlier screenshot over the frozen screen under the pointer, preselected and annotatable;
/// the result is a new attachment. Copying instead puts the same result on the clipboard and
/// attaches nothing, so the page's call answers `cancelled`.
///
/// A ``ScreenshotRequest`` from the screenshot shortcut or the mini panel (`toolbar`) also shows
/// the screenshot toolbar's command row, whose launches come back with the attachment, and can
/// switch to recording (architecture C1, S1–S8, R1): Start hands the selection to ``recorder``
/// once the overlays are gone, and nothing is imported. Its screenshot selection can also become
/// a long screenshot, whose image goes to ``longScreenshots`` the same way, or to the clipboard
/// when the screenshot shortcut copies it.
///
/// Around the session it owns the app's state: the panel is withdrawn and later restored as it
/// was, the app is activated for the overlays (cursor, keyboard, input methods) and hands
/// activation back to the app that was frontmost before. A session holds the interactive screen
/// (``DeviceArbiter``) from its claim to its end, and its copy claims the clipboard.
final class ScreenshotTaker {
  /// How a session ended, for the calls to answer in their own result types.
  enum SessionEnd {
    /// Also a copy: the page gets nothing to attach either way.
    case cancelled
    case notPermitted
    case confirmed(Confirmed)
    case record(CaptureRecordRequest)
    case longScreenshot(LongScreenshotImage)
    /// A long screenshot for the clipboard: nothing to attach either.
    case copiedLongScreenshot(LongScreenshotImage)
    /// A text command's result card ended the capture (decision D10): nothing to attach.
    case textResult(CaptureTextHandoff)
  }

  /// What takes over once a session's claim and overlays are gone.
  private enum Handoff {
    case record(CaptureRecordRequest)
    case longScreenshot(LongScreenshotImage)
    case copyLongScreenshot(LongScreenshotImage)
    case textResult(CaptureTextHandoff)
  }

  struct Confirmed {
    let capture: CaptureConfirmation
    let launch: CaptureLaunch?
    let target: ShortcutCommandEvent.Target?
    let capturedAt: Date
    let snapshot: WindowSnapshot
  }

  private let library: CaptureLibrary
  let panel: PanelWindowController
  let targeting: any ElementTargeting
  /// Where the Screen Recording prompt is asked, once per launch.
  private let access: ScreenRecordingTrust
  let makeEditor: @MainActor () -> any AnnotationEditing
  let arbiter: DeviceArbiter
  /// The running session; a quit or a display change ends it through ``cancel()``.
  var session: CaptureSession?
  /// One capture or edit at a time: a second call is refused rather than queued, because each
  /// call starts an interactive session the user would otherwise face twice.
  private(set) var isCapturing = false {
    didSet { if isCapturing != oldValue { onCapturingChange?(isCapturing) } }
  }
  /// Told when a capture or edit starts and ends; the mini panel leaves the screen meanwhile, so
  /// it is in no frozen image and never over the overlays.
  var onCapturingChange: ((_ capturing: Bool) -> Void)?
  /// macOS shows the Accessibility hint's prompt once per launch; asking again within a launch
  /// would only reopen System Settings uninvited. (The Screen Recording prompt follows the same
  /// rule in ``ScreenRecordingTrust``.)
  var trustRequested = false
  /// The last confirmed capture per display, which `R` selects again in later sessions.
  var regions = CaptureRegionMemory()

  // MARK: Injected by the shell (each is read when a request's session starts)

  /// Takes a record-mode selection once its session is gone. Nil: no session offers recording.
  /// Its `isBusy` refuses every capture while a recording counts down, runs or is processed.
  var recorder: (any CaptureRecording)?
  /// Builds the record bar for a record-mode selection; nil shows none, and Return starts.
  var makeRecordAccessory: (@MainActor () -> any CaptureRecordAccessory)?
  /// Shows a finished long screenshot once its session is gone: the island's result card.
  var longScreenshots: (any LongScreenshotResults)?
  /// The commands placed on the screenshot toolbar, in order (`screenshotToolbar.set`).
  var toolbarCommands: [SelectionToolbarSettings.Command] = []
  /// The commands placed on `screenshotText` that read the selection, in order
  /// (`screenshotToolbar.set`'s `textCommands`): what the capture editor and the long
  /// screenshot's full-screen preview offer on text picked in the screenshot.
  var textCommands: [SelectionToolbarSettings.Command] = []
  /// Runs those commands while their surface stays open (`captureText.*`); the shell sets it.
  var textRuns: CaptureTextRunner?
  /// Writes a text command's answer at the cursor the capture recorded (a result card's Insert),
  /// once the overlays are gone and the app in front has its field back.
  var writeAnswer: ((String) -> Void)?
  /// The commands' options (`commandOptions.set`).
  var commandOptions: () -> CommandOptionsCatalog = { CommandOptionsCatalog() }
  /// The current screenshot shortcut's keycap label; nil when it is not registered.
  var copyShortcut: () -> String? = { nil }
  /// A command's option values picked in a command row menu (`commandOptions.picked`).
  var onCommandOptionsPicked: ((String, CommandArguments) -> Void)?
  /// Opens Settings › Commands; called once the session that asked for it is gone.
  var openCommandSettings: (() -> Void)?
  /// More's last row was picked: the session ends and the settings open after it.
  var opensCommandSettings = false

  init(
    library: CaptureLibrary, panel: PanelWindowController, targeting: any ElementTargeting,
    access: ScreenRecordingTrust, makeEditor: @escaping @MainActor () -> any AnnotationEditing,
    arbiter: DeviceArbiter
  ) {
    self.library = library
    self.panel = panel
    self.targeting = targeting
    self.access = access
    self.makeEditor = makeEditor
    self.arbiter = arbiter
  }

  /// Ends the selection overlays before a quit confirmation can appear beneath them.
  func cancel() { session?.cancel() }

  /// Repeating the screenshot shortcut acts on the current session instead of summoning again.
  func copyFromShortcut() { session?.copyFromShortcut() }

  /// The plain capture: an image to attach, or `cancelled`. It launches nothing, records no
  /// target and never records the screen.
  func captureImage() async throws(BridgeError) -> ScreenshotCaptureResult {
    let outcome = try await capture(.image, writeTargets: nil)
    return ScreenshotCaptureResult(outcome)
  }

  /// Runs `request`'s session. For a `toolbar` request the focused field of the app in front is
  /// recorded in `writeTargets` before the overlays take the keyboard. A recording begins, and a
  /// long screenshot's card shows or its copy is written, only once the session's claim and its
  /// overlays are gone, so the recording sees the live screen, the card can annotate the image
  /// in a new session, and encoding a long image holds up no other capture.
  func capture(_ request: ScreenshotRequest, writeTargets: WriteTargets?)
    async throws(BridgeError) -> ScreenshotOutcome
  {
    let (outcome, handoff) = try await attach(request, writeTargets: writeTargets)
    switch handoff {
    case .record(let recording): recorder?.begin(recording)
    case .longScreenshot(let shot): longScreenshots?.show(shot)
    case .copyLongScreenshot(let shot): copy(shot)
    case .textResult(.open(let runId)): textRuns?.act(.open, runId: runId)
    case .textResult(.insert(let answer)): writeAnswer?(answer)
    case nil: break
    }
    if opensCommandSettings {
      opensCommandSettings = false
      openCommandSettings?()
    }
    return outcome
  }

  /// Reopens `resourceId` for editing. The base image is ready before anything is shown, so
  /// a download that fails rejects the call without a session.
  func edit(resourceId: String) async throws(BridgeError) -> ScreenshotEditResult {
    let screen = try claim()
    defer { release(screen) }
    guard CGPreflightScreenCaptureAccess() else {
      guard await ShortcutRelease.waitForHandoff() else {
        throw BridgeError("The screenshot was cancelled.")
      }
      requestScreenAccess()
      return .notOk(.init(reason: .notPermitted))
    }
    let base = try await library.base(for: resourceId)
    switch try await runSession(reopening: base, request: .image, writeTargets: nil) {
    case .cancelled, .record, .longScreenshot, .copiedLongScreenshot, .textResult:
      return .notOk(.init(reason: .cancelled))
    case .notPermitted:
      return .notOk(.init(reason: .notPermitted))
    case .confirmed(let confirmed):
      let imported = try await library.importCapture(
        confirmed.capture, capturedAt: confirmed.capturedAt, snapshot: nil)
      return .ok(
        .init(
          file: imported.file, context: nil,
          capturedAt: CapturedText.timestamp(confirmed.capturedAt)))
    }
  }

  /// The session under its claim, and the import; what takes over, if it ended there.
  private func attach(_ request: ScreenshotRequest, writeTargets: WriteTargets?)
    async throws(BridgeError) -> (ScreenshotOutcome, Handoff?)
  {
    let screen = try claim()
    defer { release(screen) }
    switch try await runSession(reopening: nil, request: request, writeTargets: writeTargets) {
    case .cancelled:
      return (.cancelled, nil)
    case .notPermitted:
      return (.notPermitted, nil)
    case .record(let recording):
      return (.recording, .record(recording))
    case .longScreenshot(let shot):
      return (.longScreenshot, .longScreenshot(shot))
    case .copiedLongScreenshot(let shot):
      return (.cancelled, .copyLongScreenshot(shot))
    case .textResult(let handoff):
      return (.cancelled, .textResult(handoff))
    case .confirmed(let confirmed):
      let capture = confirmed.capture
      regions.remember(
        capture.selection, displayID: capture.displayID, displayFrame: capture.displayFrame)
      let imported = try await library.importCapture(
        capture, capturedAt: confirmed.capturedAt, snapshot: confirmed.snapshot)
      return (
        .attached(
          ScreenshotAttachment(
            file: imported.file, context: imported.context,
            capturedAt: CapturedText.timestamp(confirmed.capturedAt), launch: confirmed.launch,
            target: confirmed.launch == nil ? nil : confirmed.target,
            selection: confirmed.launch == nil ? nil : capture.pickedText)),
        nil
      )
    }
  }

  /// One capture or edit at a time, holding the interactive screen; ``release(_:)`` ends it.
  func claim() throws(BridgeError) -> ResourceClaim {
    guard !isCapturing else { throw BridgeError("A screenshot is already being taken.") }
    guard recorder?.isBusy != true else {
      throw BridgeError("The screen is being recorded; stop the recording first.")
    }
    guard let screen = try? arbiter.tryClaim([.interactiveScreen], owner: .user(.screenshot))
    else { throw BridgeError("Another action is using the screen; try again.") }
    isCapturing = true
    return screen
  }

  func release(_ screen: ResourceClaim) {
    isCapturing = false
    screen.release()
  }

  /// Asks for Screen Recording (once per launch), for a call that answers `notPermitted`.
  func requestScreenAccess() {
    access.prompt()
  }
}
