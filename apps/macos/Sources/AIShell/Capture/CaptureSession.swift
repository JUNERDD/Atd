import AICore
import AppKit

/// One interactive capture over frozen displays (decisions D7, D8): an overlay per display, the
/// detected area under the pointer, a free or detected selection, and on the committed selection
/// the annotation editor or, in record mode, the record bar (``CaptureSession+Mode.swift``), with
/// the bottom bar beside it all (``CaptureSession+Idle.swift``); a screenshot selection can turn
/// into the long screenshot's live phase (``CaptureSession+LongScreenshot.swift``). It ends once,
/// with an ``Outcome``; the overlays are gone by then.
///
/// The displays form one desktop (``FrozenDesktop``) whose points every overlay view uses, so
/// the detected area, the selection and the annotations are each one rect in desktop points
/// that may span displays; each overlay draws the part on its display, and the export stitches
/// the displays' pixels.
///
/// Everything runs on the main actor. Element detection is the injected ``ElementTargeting``,
/// whose answers arrive asynchronously; at most one request is in flight and the latest
/// pointer position is asked next, so a slow app never queues work behind every mouse move.
/// The annotation editor comes from `makeEditor` when a selection is committed.
///
/// A session that reopens a screenshot for editing (decision F2) never starts detection: the
/// caller preselects the image with ``preselect(_:onDisplay:restoring:)`` instead.
final class CaptureSession {
  enum Outcome {
    case cancelled
    /// The user clicked the Accessibility hint; the caller asks for trust once the overlays
    /// are gone, since the system's prompt would open beneath them.
    case wantsAccessibility
    case confirmed(CaptureConfirmation)
    /// The same result as `confirmed`, for the clipboard rather than an attachment.
    case copied(CaptureConfirmation)
    /// The same result as `confirmed`, with a command or a question to run on it (S1, S3).
    case launched(CaptureConfirmation, CaptureLaunch)
    /// Record mode's Start: the selection to record. The overlays are gone by the time the caller
    /// sees it, so the recording shows the live screen (R1).
    case record(CaptureRecordRequest)
    /// The live long screenshot's Done: the stitched image, for the island's result card. The
    /// overlays are gone by the time the caller sees it.
    case longScreenshot(LongScreenshotImage)
    /// The same image as `longScreenshot`, for the clipboard rather than the result card.
    case copiedLongScreenshot(LongScreenshotImage)
    /// A text command's result card ended the capture to open its task or write its answer
    /// (decision D10); nothing is attached.
    case textResult(CaptureTextHandoff)
    case failed
  }

  /// A detected element the selection was committed from: where the click was and the
  /// element's area, both Quartz, and the selection it became (desktop points). It describes
  /// the capture only while the selection is still exactly that.
  struct Pick {
    let point: CGPoint
    let frame: CGRect
    let selection: CGRect
  }

  /// Rects and points are desktop points.
  enum Phase {
    /// The detected area under the pointer is offered.
    case idle
    /// The button is down in idle on an overlay; a click commits its detected area, a drag
    /// starts a free one.
    case pressing(CaptureOverlayView, start: CGPoint)
    case creating(SelectionDrag)
    /// A committed selection with the annotation editor on it; it moves and resizes at any
    /// time, across displays too, and the annotations stay where they are on the screen.
    case selected(CGRect)
    /// The committed selection is being moved or resized with the mouse.
    case adjusting(SelectionDrag)
    /// The long screenshot's live phase over the committed selection, which stays put
    /// (``CaptureSession+LongScreenshot.swift``).
    case longScreenshot(CGRect)
  }

  let targeting: any ElementTargeting
  let makeEditor: @MainActor () -> any AnnotationEditing
  /// The Accessibility hint asks for trust only once per launch; after that it only informs.
  let offersTrustRequest: Bool
  /// The last confirmed selection per display, offered by `R` (decision F3).
  let regions: CaptureRegionMemory
  /// What the session offers besides annotating (``CaptureSessionOptions``).
  var options: CaptureSessionOptions
  /// Screenshot or record (C1); a session that cannot record stays a screenshot.
  var mode: CaptureMode
  /// `W` limits candidates to windows and displays. Both capture modes start with elements;
  /// switching modes preserves the user's targeting scope.
  var onlyWindows = false
  /// The record bar on a record-mode selection (``CaptureRecordAccessory``).
  var accessory: (any CaptureRecordAccessory)?
  /// Where the record bar last went beside the selection, held while it is dragged.
  var accessoryAnchor: AnnotationToolbarLayout.Anchor?
  /// The screenshot's annotations (desktop points) while record mode shows, back on the
  /// selection when the session returns to screenshot mode (C1).
  var shotDocument: AnnotationDocument?
  /// Reads the selection's text while it is edited (S5).
  let reader = CaptureTextReader()
  /// What the long screenshot keeps: its probes and its live phase (``CaptureLongScreenshot``).
  let longScreenshot = CaptureLongScreenshot()
  /// The element the current selection was committed from, if it was.
  var pick: Pick?
  /// Set by ``arrange(quartzBounds:)`` before any display is added.
  private(set) var desktop = FrozenDesktop(quartzBounds: .zero)
  /// The selection geometry over the displays added so far.
  private(set) var model = SelectionModel(bounds: .zero, displays: [])
  private(set) var overlays: [CaptureOverlayView] = []
  /// Set by ``activate()`` once every display is frozen. Until then the overlays are inert: the
  /// pointer is ignored, so nothing is selected over displays that have no overlay yet.
  private(set) var isActive = false
  var phase = Phase.idle
  /// A tool is chosen: presses inside the selection, away from its handles and edge band, are
  /// the editor's. The selection itself stays adjustable either way (D14).
  var interiorClaimed = false
  var editor: (any AnnotationEditing)?
  private(set) var detection: ElementDetection?
  /// Detection was started; only then is it ended (and asked to describe a pick).
  private var began = false
  /// The latest pointer position and the overlay it is on.
  var pointer: (overlay: CaptureOverlayView, point: CGPoint)?
  /// Candidate areas under the pointer on `chainOverlay`, smallest first, ending with its
  /// display; `chainIndex` is the one offered (`CaptureSession+Hover.swift`).
  var chain: [CGRect] = []
  weak var chainOverlay: CaptureOverlayView?
  var chainIndex = 0
  var hoverInFlight = false
  private var beginTask: Task<Void, Never>?
  private var outcome: Outcome?
  private var continuation: CheckedContinuation<Outcome, Never>?
  private var observers: [any NSObjectProtocol] = []

  init(
    targeting: any ElementTargeting, offersTrustRequest: Bool, regions: CaptureRegionMemory,
    options: CaptureSessionOptions = CaptureSessionOptions(),
    makeEditor: @escaping @MainActor () -> any AnnotationEditing
  ) {
    self.targeting = targeting
    self.offersTrustRequest = offersTrustRequest
    self.regions = regions
    self.options = options
    self.makeEditor = makeEditor
    mode = options.canRecord ? options.mode : .screenshot
    reader.onChange = { [weak self] text in self?.editor?.recognizedText = text }
    // A frozen image no longer matches a rearranged display, and an app switch takes the
    // keyboard away from the overlays: both end the session. A live long screenshot passes
    // clicks through to the app under it, which then becomes active: that switch is its own.
    let center = NotificationCenter.default
    for name in [
      NSApplication.didChangeScreenParametersNotification,
      NSApplication.didResignActiveNotification,
    ] {
      let resigns = name == NSApplication.didResignActiveNotification
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated {
            guard let self, !(resigns && self.passesInputThrough) else { return }
            self.cancel()
          }
        })
    }
  }

  var isFinished: Bool { outcome != nil }

  /// Starts element detection over the pre-overlay window snapshot.
  func begin(windows: [CaptureWindow]) {
    began = true
    let targeting = targeting
    beginTask = Task {
      let detection = await targeting.begin(windows: windows)
      guard !isFinished else { return }
      self.detection = detection
      refreshBars()
      requestHover()
      if case .selected(let rect) = phase { probeScrollArea(in: rect) }
    }
  }

  /// Sets the desktop to `quartzBounds`, the union of every display about to be frozen, so
  /// desktop points stay put while displays are added one by one.
  func arrange(quartzBounds: CGRect) {
    guard overlays.isEmpty else { return }
    desktop = FrozenDesktop(quartzBounds: quartzBounds)
  }

  /// Puts a frozen display's overlay on its screen, inert until ``activate()``.
  func add(_ display: FrozenDisplay, on screen: NSScreen) {
    guard !isFinished else { return }
    desktop.add(display)
    model = desktop.geometry.selectionModel
    let view = CaptureOverlayView(display: display, frame: desktop.frame(of: display))
    view.delegate = self
    let panel = CaptureOverlayPanel(screen: screen, content: view)
    panel.orderFrontRegardless()
    overlays.append(view)
    view.show(area: nil, handles: false)
    refreshBar(on: view)
  }

  /// Every display is frozen: the overlay under the pointer takes the keyboard and the
  /// detected area follows the pointer.
  func activate() {
    guard !isFinished else { return }
    isActive = true
    let mouse = NSEvent.mouseLocation
    let overlay =
      overlays.first { NSMouseInRect(mouse, $0.window?.frame ?? .zero, false) } ?? overlays.first
    guard let overlay, let window = overlay.window else { return }
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(overlay)
    pointer = (overlay, overlay.convert(window.mouseLocationOutsideOfEventStream, from: nil))
    refreshBars()
    renderIdle()
    requestHover()
  }

  /// Suspends until the session ends, then ends element detection. A confirmed (or launched)
  /// selection that is still the element it was picked from is described first, while detection
  /// still has that app prepared.
  func run() async -> Outcome {
    var outcome: Outcome
    if let finished = self.outcome {
      outcome = finished
    } else {
      outcome = await withCheckedContinuation { continuation = $0 }
    }
    await beginTask?.value
    guard began else { return outcome }
    func described(_ confirmation: CaptureConfirmation) async -> CaptureConfirmation {
      guard let pick, pick.selection == confirmation.desktopSelection else { return confirmation }
      var described = confirmation
      described.element = await targeting.describe(at: pick.point, frame: pick.frame)
      return described
    }
    switch outcome {
    case .confirmed(let confirmation): outcome = .confirmed(await described(confirmation))
    case .launched(let confirmation, let launch):
      outcome = .launched(await described(confirmation), launch)
    case .cancelled, .wantsAccessibility, .copied, .record, .longScreenshot,
      .copiedLongScreenshot, .textResult, .failed:
      break
    }
    await targeting.end()
    return outcome
  }

  func cancel() { finish(.cancelled) }

  /// Renders the selection with and without its annotations and ends the session with them; in
  /// record mode, starts the recording instead (Return, a double-click).
  func confirm() {
    guard mode == .screenshot else { return startRecording() }
    end(as: Outcome.confirmed)
  }

  /// Ends the session like ``confirm()``, with the result meant for the clipboard.
  func copy() { end(as: Outcome.copied) }

  /// Ends the session like ``confirm()``, with `launch` to run on the result.
  func launch(_ launch: CaptureLaunch) { end { .launched($0, launch) } }

  /// The editor's document, open text committed, is read before ``finish(_:)`` hides it. The
  /// confirmation names the display holding most of the selection, with the selection in its
  /// view points. A selection moved wholly into a gap between displays holds no pixels and
  /// confirms nothing.
  private func end(as outcome: (CaptureConfirmation) -> Outcome) {
    editor?.endText()
    guard case .selected(let rect) = phase,
      !desktop.geometry.displays(overlapping: rect).isEmpty
    else { return }
    guard
      let rendered = CaptureExport.render(selection: rect, desktop: desktop, editor: editor),
      let primary = desktop.geometry.primary(for: rect)
    else { return finish(.failed) }
    let origin = desktop.geometry.desktopPoint(primary.quartzFrame.origin)
    var confirmation = CaptureConfirmation(
      image: rendered.image, raw: rendered.raw, pixelScale: rendered.scale,
      document: editor?.document ?? AnnotationDocument(), displayID: primary.id,
      displayFrame: primary.quartzFrame,
      selection: rect.offsetBy(dx: -origin.x, dy: -origin.y), desktopSelection: rect)
    confirmation.pickedText = editor?.pickedText
    finish(outcome(confirmation))
  }

  /// Edit mode: makes `rect` (view points of the display `displayID`) the selection and puts
  /// `document` (selection-local) back on it, still editable.
  func preselect(
    _ rect: CGRect, onDisplay displayID: CGDirectDisplayID, restoring document: AnnotationDocument
  ) {
    guard !isFinished, let owner = overlays.first(where: { $0.display.displayID == displayID })
    else { return }
    if let window = owner.window {
      window.makeKeyAndOrderFront(nil)
      window.makeFirstResponder(owner)
      pointer = (owner, owner.convert(window.mouseLocationOutsideOfEventStream, from: nil))
    }
    commit(rect.offsetBy(dx: owner.bounds.minX, dy: owner.bounds.minY))
    if !document.isEmpty { editor?.restore(document) }
  }

  func finish(_ outcome: Outcome) {
    guard self.outcome == nil else { return }
    self.outcome = outcome
    phase = .idle
    editor?.hide()
    editor = nil
    accessory?.hide()
    accessory = nil
    reader.cancel()
    longScreenshot.end()
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers.removeAll()
    for overlay in overlays {
      guard let window = overlay.window else { continue }
      // AppKit may keep a closed window alive; its frozen pixels must end with this session.
      window.contentView = nil
      window.close()
    }
    // The views and the desktop hold the frozen images, tens of megabytes per Retina display.
    overlays.removeAll()
    desktop = FrozenDesktop(quartzBounds: .zero)
    pointer = nil
    continuation?.resume(returning: outcome)
    continuation = nil
  }
}
