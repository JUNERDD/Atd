import AICore
import AppKit

/// One interactive capture over frozen displays (decisions D7, D8): an overlay per display, the
/// detected area under the pointer, a free or detected selection, and the annotation editor on
/// the committed selection. It ends once, with an ``Outcome``; the overlays are gone by then.
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
  }

  let targeting: any ElementTargeting
  let makeEditor: @MainActor () -> any AnnotationEditing
  /// The Accessibility hint asks for trust only once per launch; after that it only informs.
  let offersTrustRequest: Bool
  /// The last confirmed selection per display, offered by `R` (decision F3).
  let regions: CaptureRegionMemory
  /// `W` reduced the candidates to the window and the display; per session.
  var onlyWindows = false
  /// The element the current selection was committed from, if it was.
  var pick: Pick?
  /// Set by ``arrange(quartzBounds:)`` before any display is added.
  private(set) var desktop = FrozenDesktop(quartzBounds: .zero)
  /// The selection geometry over the displays added so far.
  private(set) var model = SelectionModel(bounds: .zero, displays: [])
  private(set) var overlays: [CaptureOverlayView] = []
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
    makeEditor: @escaping @MainActor () -> any AnnotationEditing
  ) {
    self.targeting = targeting
    self.offersTrustRequest = offersTrustRequest
    self.regions = regions
    self.makeEditor = makeEditor
    // A frozen image no longer matches a rearranged display, and an app switch takes the
    // keyboard away from the overlays: both end the session.
    let center = NotificationCenter.default
    for name in [
      NSApplication.didChangeScreenParametersNotification,
      NSApplication.didResignActiveNotification,
    ] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.cancel() }
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
      refreshHints()
      requestHover()
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
    view.showHints(hintTexts(on: view))
  }

  /// Every display is frozen: the overlay under the pointer takes the keyboard and the
  /// detected area follows the pointer.
  func activate() {
    guard !isFinished else { return }
    let mouse = NSEvent.mouseLocation
    let overlay =
      overlays.first { NSMouseInRect(mouse, $0.window?.frame ?? .zero, false) } ?? overlays.first
    guard let overlay, let window = overlay.window else { return }
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(overlay)
    pointer = (overlay, overlay.convert(window.mouseLocationOutsideOfEventStream, from: nil))
    refreshHints()
    renderIdle()
    requestHover()
  }

  /// Suspends until the session ends, then ends element detection. A confirmed selection that
  /// is still the element it was picked from is described first, while detection still has
  /// that app prepared.
  func run() async -> Outcome {
    var outcome: Outcome
    if let finished = self.outcome {
      outcome = finished
    } else {
      outcome = await withCheckedContinuation { continuation = $0 }
    }
    await beginTask?.value
    guard began else { return outcome }
    if case .confirmed(var confirmation) = outcome, let pick,
      pick.selection == confirmation.desktopSelection
    {
      confirmation.element = await targeting.describe(at: pick.point, frame: pick.frame)
      outcome = .confirmed(confirmation)
    }
    await targeting.end()
    return outcome
  }

  func cancel() { finish(.cancelled) }

  /// Renders the selection with and without its annotations and ends the session with them.
  func confirm() { end(as: Outcome.confirmed) }

  /// Ends the session like ``confirm()``, with the result meant for the clipboard.
  func copy() { end(as: Outcome.copied) }

  /// The editor's document is read before ``finish(_:)`` hides it. The confirmation names the
  /// display holding most of the selection, with the selection in its view points. A selection
  /// moved wholly into a gap between displays holds no pixels and confirms nothing.
  private func end(as outcome: (CaptureConfirmation) -> Outcome) {
    guard case .selected(let rect) = phase,
      !desktop.geometry.displays(overlapping: rect).isEmpty
    else { return }
    guard
      let rendered = CaptureExport.render(selection: rect, desktop: desktop, editor: editor),
      let primary = desktop.geometry.primary(for: rect)
    else { return finish(.failed) }
    let origin = desktop.geometry.desktopPoint(primary.quartzFrame.origin)
    finish(
      outcome(
        CaptureConfirmation(
          image: rendered.image, raw: rendered.raw, pixelScale: rendered.scale,
          document: editor?.document ?? AnnotationDocument(), displayID: primary.id,
          displayFrame: primary.quartzFrame,
          selection: rect.offsetBy(dx: -origin.x, dy: -origin.y), desktopSelection: rect)))
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
    editor?.hide()
    editor = nil
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers.removeAll()
    for overlay in overlays { overlay.window?.close() }
    // The views and the desktop hold the frozen images, tens of megabytes per Retina display.
    overlays.removeAll()
    desktop = FrozenDesktop(quartzBounds: .zero)
    pointer = nil
    continuation?.resume(returning: outcome)
    continuation = nil
  }
}

/// A confirmed capture: what is imported, and what reopening it later needs (decision F2).
struct CaptureConfirmation {
  /// The selection's pixels with the annotations drawn in.
  let image: CGImage
  /// The same pixels without annotations.
  let raw: CGImage
  /// Pixels per point of the image: the display's, or the finest of those a selection spans.
  let pixelScale: CGFloat
  /// The annotations, selection-local.
  let document: AnnotationDocument
  /// The display holding most of the selection.
  let displayID: CGDirectDisplayID
  /// That display's Quartz frame.
  let displayFrame: CGRect
  /// The selection in that display's view points; it reaches past the display when it spans
  /// several.
  let selection: CGRect
  /// The selection in the session's desktop points.
  let desktopSelection: CGRect
  /// The element the selection was picked from, described; set by ``CaptureSession/run()``.
  var element: ElementDescription?
}
