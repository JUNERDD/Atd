import AICore
import AppKit

/// The content of one display's overlay, flipped, with its bounds at the display's area of the
/// session's desktop: its points (and those of the chrome and the annotation host) are desktop
/// points, so a selection spanning displays is one rect on every overlay. From back to front: the frozen image, the dim and selection
/// chrome, the annotation host, the loupe and the bar host with the bottom bar (``CaptureBar``)
/// and the Accessibility request. Only this view, what the annotation editor adds and the bars
/// take events; the rest is drawn and ignores the mouse.
///
/// Keys reach this view as the window's first responder. When the annotation editor makes its
/// canvas (a descendant of ``annotationHost``) first responder, the canvas sees keys first and
/// whatever it leaves unhandled climbs the responder chain back to this view. That is the
/// contract behind two shortcuts:
///
/// - Escape steps back one level. The editor ends text editing, deselects an annotation or
///   drops its tool, consuming the key only when it did one of those; an Escape it passes on
///   reaches ``keyDown(with:)`` here and cancels the session.
/// - Select All (⌘A) is the main menu's `selectAll:` through the responder chain: an open text
///   editor answers it first, otherwise it reaches ``selectAll(_:)`` here. ``keyDown(with:)``
///   covers the key arriving unhandled instead.
final class CaptureOverlayView: NSView {
  let display: FrozenDisplay
  weak var delegate: (any CaptureOverlayDelegate)?
  let annotationHost = AnnotationHostView()
  private let frozenImage = FrozenImageView()
  private let chrome: CaptureChromeView
  private let loupe: LoupeView
  /// Above everything else, so the bottom bar stays clickable over a selection that fills the
  /// display; its own area never takes the mouse.
  private let barHost = AnnotationHostView()
  private let bar = CaptureBar()
  private var trustRequest: CaptureTrustRequest?
  /// Trackpads scroll in many small steps; the chain walks once per this many points.
  private var scrollAccumulator: CGFloat = 0
  private static let scrollStep: CGFloat = 12
  /// The last mouse position while the button is down, so a Shift change re-applies the drag.
  private var dragPoint: CGPoint?

  /// `frame` is the display's area of the desktop (desktop points).
  init(display: FrozenDisplay, frame: CGRect) {
    self.display = display
    chrome = CaptureChromeView(frame: frame)
    loupe = LoupeView(image: display.image, scale: display.pixelScale)
    super.init(frame: CGRect(origin: .zero, size: frame.size))
    setBoundsOrigin(frame.origin)
    wantsLayer = true
    frozenImage.frame = bounds
    frozenImage.image = NSImage(cgImage: display.image, size: frame.size)
    frozenImage.imageScaling = .scaleAxesIndependently
    annotationHost.frame = bounds
    annotationHost.setBoundsOrigin(bounds.origin)
    for view in [frozenImage, chrome, annotationHost] as [NSView] { addSubview(view) }
    loupe.isHidden = true
    addSubview(loupe)
    barHost.frame = bounds
    barHost.setBoundsOrigin(bounds.origin)
    addSubview(barHost)
    bar.isHidden = true
    barHost.addSubview(bar)
    bar.onMode = { [weak self] mode in
      guard let self else { return }
      delegate?.overlay(self, perform: .mode(mode))
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Drawing

  /// The undimmed area (desktop points, drawn where it lies on this display) with its outline,
  /// its size label when `label` is given, and handles only on a committed selection.
  func show(area: CGRect?, handles: Bool, label: String? = nil) {
    chrome.update(area: area, handles: handles, label: label)
  }

  /// Whether the frozen screen shows (decision D1). The long screenshot's live phase hides it
  /// and the loupe that magnifies it: nothing is then drawn over the selection, a transparent
  /// hole through which the user's scrolls and clicks reach the app under it, and the dim around
  /// it lies over the live screen.
  var showsFrozenScreen: Bool {
    get { !frozenImage.isHidden }
    set {
      frozenImage.isHidden = !newValue
      if !newValue { loupe.isHidden = true }
    }
  }

  /// The loupe beside `point` (desktop points, on this display), or hidden for nil; never while
  /// the frozen screen is hidden.
  func showLoupe(at point: CGPoint?) {
    guard let point, showsFrozenScreen else {
      loupe.isHidden = true
      return
    }
    let local = CGPoint(x: point.x - bounds.minX, y: point.y - bounds.minY)
    loupe.update(
      at: local, quartz: CaptureCoordinates.quartzPoint(local, display: display.quartzFrame))
    loupe.place(near: point, in: bounds)
    loupe.isHidden = false
  }

  // MARK: Bottom bar

  /// The bottom bar showing `content`, placed for `selection` (``CaptureBarLayout``), or hidden
  /// for nil. With `trustRequest` the Accessibility request stands beside it, clickable while
  /// `trustRequest` is true.
  func showBar(_ content: CaptureBar.Content?, selection: CGRect?, trustRequest: Bool?) {
    guard let content else {
      bar.isHidden = true
      self.trustRequest?.isHidden = true
      return
    }
    bar.update(content)
    let insets = window?.screen?.safeAreaInsets
    let frame = CaptureBarLayout.frame(
      size: bar.fittingSize, display: bounds, safeTop: insets?.top ?? 0,
      safeBottom: insets?.bottom ?? 0, selection: selection)
    bar.frame = frame
    bar.isHidden = false
    guard let enabled = trustRequest else {
      self.trustRequest?.isHidden = true
      return
    }
    let request = self.trustRequest ?? makeTrustRequest()
    request.isEnabled = enabled
    request.frame = CaptureBarLayout.requestFrame(
      size: request.fittingSize, bar: frame, display: bounds)
    request.isHidden = false
  }

  private func makeTrustRequest() -> CaptureTrustRequest {
    let request = CaptureTrustRequest()
    request.onRequest = { [weak self] in
      guard let self else { return }
      delegate?.overlay(self, perform: .requestAccessibility)
    }
    barHost.addSubview(request)
    trustRequest = request
    return request
  }

  /// Where the bottom bar is (desktop points), nil while it is hidden.
  var barFrame: CGRect? { bar.isHidden ? nil : bar.frame }

  /// Where the selection's size label is drawn on this display (desktop points), if it is.
  var sizeLabelFrame: CGRect? { chrome.labelFrame }

  // MARK: Mouse

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for area in trackingAreas { removeTrackingArea(area) }
    // `activeAlways`: a display's overlay follows the pointer before it is the key window.
    addTrackingArea(
      NSTrackingArea(
        rect: .zero,
        options: [
          .activeAlways, .mouseMoved, .mouseEnteredAndExited, .inVisibleRect, .cursorUpdate,
        ],
        owner: self))
  }

  override func mouseEntered(with event: NSEvent) { pointerMoved(event) }

  override func mouseMoved(with event: NSEvent) { pointerMoved(event) }

  override func cursorUpdate(with event: NSEvent) { hoverCursor(at: point(of: event)) }

  override func mouseDown(with event: NSEvent) {
    // The keyboard comes to this display, but stays with the editor's canvas or open text when
    // they have it: the selection's handles are pressed here while annotating.
    if !((window?.firstResponder as? NSView)?.isDescendant(of: self) ?? false) {
      window?.makeFirstResponder(self)
    }
    let point = point(of: event)
    dragPoint = point
    delegate?.overlay(self, mouseDownAt: point, clickCount: event.clickCount)
    delegate?.overlay(self, cursorAt: point)?.set()
  }

  /// No cursor updates arrive while the button is down; the drag's cursor is kept here.
  override func mouseDragged(with event: NSEvent) {
    let point = point(of: event)
    dragPoint = point
    delegate?.overlay(self, mouseDraggedTo: point, square: Self.squares(event.modifierFlags))
    delegate?.overlay(self, cursorAt: point)?.set()
  }

  override func mouseUp(with event: NSEvent) {
    let point = point(of: event)
    dragPoint = nil
    delegate?.overlay(self, mouseUpAt: point, square: Self.squares(event.modifierFlags))
    hoverCursor(at: point)
  }

  /// Pressing or releasing Shift mid-drag reshapes the selection without a mouse move.
  override func flagsChanged(with event: NSEvent) {
    if let dragPoint {
      delegate?.overlay(
        self, mouseDraggedTo: dragPoint, square: Self.squares(event.modifierFlags))
    }
    super.flagsChanged(with: event)
  }

  private static func squares(_ flags: NSEvent.ModifierFlags) -> Bool {
    flags.intersection(.deviceIndependentFlagsMask).contains(.shift)
  }

  override func rightMouseDown(with event: NSEvent) { delegate?.overlayRightClicked(self) }

  /// Events over the editor's canvas and bars arrive here too, up the responder chain.
  override func scrollWheel(with event: NSEvent) {
    if annotationHost.scroll?(event) == true { return }
    guard event.hasPreciseScrollingDeltas else {
      if event.scrollingDeltaY != 0 { delegate?.overlay(self, perform: .walk(step(event))) }
      return
    }
    if event.phase == .began { scrollAccumulator = 0 }
    scrollAccumulator += event.scrollingDeltaY
    guard abs(scrollAccumulator) >= Self.scrollStep else { return }
    scrollAccumulator = 0
    delegate?.overlay(self, perform: .walk(step(event)))
  }

  /// Scrolling up offers a larger area, down a smaller one.
  private func step(_ event: NSEvent) -> Int { event.scrollingDeltaY > 0 ? 1 : -1 }

  private func pointerMoved(_ event: NSEvent) {
    let point = point(of: event)
    delegate?.overlay(self, pointerAt: point)
    hoverCursor(at: point)
  }

  /// Re-applies the cursor for where the pointer is now, for a change that happens without a
  /// mouse move (the editor dropping its tool on Esc hands the interior back to the session).
  func refreshCursor() {
    guard let window else { return }
    hoverCursor(at: convert(window.mouseLocationOutsideOfEventStream, from: nil))
  }

  /// The bottom bar's or the editor's bars' cursor over them, else the session's cursor where it
  /// has one (D15).
  private func hoverCursor(at point: CGPoint) {
    guard CaptureCursorOwnership.ownsPointer(in: window, at: NSEvent.mouseLocation) else { return }
    // A text command's result card: its controls set their own cursor, the arrow elsewhere on it.
    if let card = annotationHost.card(at: point) {
      card.cursor(at: point)?.set()
    } else if let cursor = barHost.barCursor(at: point) ?? annotationHost.barCursor(at: point) {
      cursor.set()
    } else {
      delegate?.overlay(self, cursorAt: point)?.set()
    }
  }

  private func point(of event: NSEvent) -> CGPoint {
    convert(event.locationInWindow, from: nil)
  }

  // MARK: Keyboard

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if super.performKeyEquivalent(with: event) { return true }
    if let editor = window?.firstResponder as? NSTextView,
      editor.hasMarkedText() || editor.isFieldEditor
    {
      return false
    }
    guard event.type == .keyDown, window?.isKeyWindow == true,
      let command = CaptureCommand(event), command == .save
    else { return false }
    delegate?.overlay(self, perform: command)
    return true
  }

  override func keyDown(with event: NSEvent) {
    // Space and W toggle modes once per press; navigation still repeats while held.
    if [49, 13].contains(event.keyCode), event.isARepeat { return }
    guard let command = CaptureCommand(event) else {
      super.keyDown(with: event)
      return
    }
    delegate?.overlay(self, perform: command)
  }

  /// Escape normally arrives in `keyDown`; this covers Command-period.
  override func cancelOperation(_ sender: Any?) { delegate?.overlay(self, perform: .cancel) }

  /// The Edit menu's Select All, when no text editor took it.
  override func selectAll(_ sender: Any?) { delegate?.overlay(self, perform: .selectDisplay) }
}
