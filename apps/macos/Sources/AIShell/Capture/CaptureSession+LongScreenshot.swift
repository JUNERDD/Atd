import AICore
import AppKit

/// The long screenshot's live phase (decisions D1, D4, D6, D10). ⌘↓ or the toolbar's button turns
/// a screenshot selection over scrolling content into a window onto the live screen: the frozen
/// image and the loupe hide, so nothing is drawn over the selection and the dim around it lies
/// over the live screen. The user's scrolls and clicks inside reach the app under it, presses
/// around it do nothing, and the engine (``LongScreenshotCapture``) stitches the selection as the
/// page moves, or scrolls it itself while auto-scroll runs (Space). The selection, its outline
/// and the chrome beside it (``LongScreenshotChromeHosting``: preview strip, control bar, status
/// row) stay put however the page scrolls; the size label follows the stitched height.
///
/// A click through the selection activates the app under it, which would end the session and
/// take the keyboard: the phase keeps the session (``passesInputThrough``) and takes the keyboard
/// back after every click without activating Atd (``LongScreenshotPassThrough``). Esc steps back
/// to the screenshot as it was, its frozen screen, selection and annotations; Return or Done ends
/// the session with the stitched image (``Outcome/longScreenshot(_:)``), which the island's
/// result card shows once the overlays are gone.
extension CaptureSession {
  /// Points per line of a wheel without precise deltas, which reports lines.
  static let longScreenshotWheelLine: CGFloat = 16

  /// Input passes through the selection to the app under it.
  var passesInputThrough: Bool {
    if case .longScreenshot = phase { true } else { false }
  }

  /// ⌘↓ or the toolbar's button: the live phase over the selection, clamped to the display
  /// holding it, or a beep where the selection does not offer it.
  func startLongScreenshot() {
    guard case .selected(let rect) = phase, longScreenshotAvailability(for: rect) == .available,
      let primary = desktop.geometry.primary(for: rect), let owner = primaryOverlay(for: rect)
    else { return NSSound.beep() }
    let part = rect.intersection(desktop.geometry.frame(of: primary))
    guard !part.isNull, part.width >= 1, part.height >= 1 else { return NSSound.beep() }
    keepAnnotations(of: rect)
    let chrome = LongScreenshotChrome()
    let live = CaptureLongScreenshot.Live(
      selection: part,
      capture: LongScreenshotCapture(target: longScreenshotTarget(for: rect, part, on: primary)),
      chrome: chrome)
    longScreenshot.begin(live)
    // The phase first, so the cursors the editor's removal refreshes are the phase's.
    phase = .longScreenshot(rect)
    unhost()
    // The selection's open hand goes; the app under it sets its own once the pointer moves.
    NSCursor.arrow.set()
    for overlay in overlays { overlay.showsFrozenScreen = false }
    show(rect, handles: false, label: longScreenshotLabel(height: part.height, of: live))
    refreshBars()
    hostChrome(of: live, on: owner, keepClear: keepClear(for: rect))
    live.previewSize = chrome.previewSize
    owner.window?.makeKey()
    owner.window?.makeFirstResponder(owner)
    longScreenshotChanged(live.capture.progress, in: live)
    Task { [weak self] in
      do {
        try await live.capture.start()
      } catch {
        self?.longScreenshotStopped(live)
      }
    }
  }

  /// The live phase's keys (``CaptureSession+Idle.swift``), the pair hidden: the screenshot
  /// shortcut's copy while it is registered, as a screenshot selection names it, auto-scroll,
  /// which reserves both of its labels, Done and Back.
  func longScreenshotBarKeys() -> [CaptureBarSegment] {
    let strings = ShellStrings.shared
    let start = strings.text(LongScreenshotCaptureStringKey.barAutoScroll)
    let pause = strings.text(LongScreenshotCaptureStringKey.barPauseScroll)
    let scrolling = longScreenshot.live?.capture.progress.autoScrolling == true
    var keys = [
      CaptureBarSegment(key: "Space", label: scrolling ? pause : start, reserved: [start, pause]),
      CaptureBarSegment(key: "↵", label: strings.text(.captureConfirm)),
      CaptureBarSegment(key: "Esc", label: strings.text(.captureHintBack)),
    ]
    if let shortcut = options.copyShortcut {
      keys.insert(
        CaptureBarSegment(key: shortcut, label: strings.text(.captureBarCopyScreenshot)), at: 0)
    }
    return keys
  }

  /// The app keeps its own cursor inside the selection; the arrow everywhere else, the chrome
  /// included where it lies over the selection.
  func longScreenshotCursor(at point: CGPoint, selection: CGRect) -> NSCursor? {
    let onChrome = longScreenshot.live?.chrome.frames.contains { $0.contains(point) } ?? false
    return selection.contains(point) && !onChrome ? nil : .arrow
  }

  /// A key in the live phase: Esc goes back, Return finishes, Space toggles auto-scroll. The
  /// selection, the mode and the candidates stay as they are while the page is captured; the
  /// screenshot shortcut, a global hot key, copies the long screenshot (`copyFromShortcut`).
  func performInLongScreenshot(_ command: CaptureCommand) {
    switch command {
    case .cancel: leaveLongScreenshot()
    case .confirm: finishLongScreenshot()
    case .toggleAutoScroll: toggleAutoScroll()
    case .walk, .nudge, .resize, .resizeLeading, .selectDisplay, .recall, .toggleWindowsOnly,
      .mode, .requestAccessibility, .longScreenshot:
      break
    }
  }

  /// Esc or the chrome's back: the screenshot as it was before, its frozen screen, selection
  /// and annotations. Atd is activated again, as a click through the selection may have made
  /// another app active, and the editor's canvas takes the keyboard.
  func leaveLongScreenshot() {
    guard case .longScreenshot(let rect) = phase else { return }
    longScreenshot.endLive()
    for overlay in overlays { overlay.showsFrozenScreen = true }
    NSApp.activate()
    phase = .selected(rect)
    show(rect, handles: true)
    refreshBars()
    host(rect)
    primaryOverlay(for: rect)?.window?.makeKey()
  }

  /// Return or the chrome's Done: the session ends with the stitched image once the engine has
  /// put it together, for the island's result card, or for the clipboard when `copying` (the
  /// screenshot shortcut pressed again); back to the screenshot when it has none.
  func finishLongScreenshot(copying: Bool = false) {
    guard let live = longScreenshot.live, !live.finishing else { return }
    live.finishing = true
    Task { [weak self] in
      let shot = await live.capture.finish()
      guard let self, longScreenshot.live === live, !isFinished else { return }
      guard let shot else {
        NSSound.beep()
        return leaveLongScreenshot()
      }
      live.finished = true
      finish(copying ? .copiedLongScreenshot(shot) : .longScreenshot(shot))
    }
  }

  /// Space or the chrome's auto-scroll button. Without the permission to post scroll events the
  /// status row says so, and Accessibility is asked for once the overlays are gone, through the
  /// Accessibility hint's own request (once per launch).
  func toggleAutoScroll() {
    guard let live = longScreenshot.live, !live.finishing else { return }
    if live.capture.progress.autoScrolling {
      live.capture.stopAutoScroll()
    } else {
      switch live.capture.startAutoScroll() {
      case .started:
        longScreenshot.needsPermission = false
      case .needsPermission:
        longScreenshot.needsPermission = true
        if offersTrustRequest { longScreenshot.asksForTrust = true }
      case .atLimit:
        break
      }
    }
    longScreenshotChanged(live.capture.progress, in: live)
  }

  /// The status row's toggle once the page's end is in the image: the scroll area's part below
  /// the selection joins the image, or leaves it again. The engine's progress shows the result.
  func toggleTail() {
    guard let live = longScreenshot.live, !live.finishing else { return }
    let tail = live.capture.progress.tail
    guard tail != .none else { return }
    live.capture.includeTail(tail == .excluded)
  }

  // MARK: The live phase

  /// The chrome beside the selection on the overlay holding it, which alone takes presses on
  /// its host (the preview strip is no glass bar), and the engine's and the monitors' callbacks,
  /// each for this phase only. Leaving the phase hosts the editor, which sets its own.
  private func hostChrome(
    of live: CaptureLongScreenshot.Live, on owner: CaptureOverlayView,
    keepClear: AnnotationToolbarLayout.KeepClear
  ) {
    live.chrome.onAutoScroll = { [weak self] in self?.toggleAutoScroll() }
    live.chrome.onBack = { [weak self] in self?.leaveLongScreenshot() }
    live.chrome.onDone = { [weak self] in self?.finishLongScreenshot() }
    live.chrome.onTail = { [weak self] in self?.toggleTail() }
    live.chrome.show(in: owner.annotationHost, selection: live.selection, keepClear: keepClear)
    owner.annotationHost.passThrough = { [weak live] point in
      !(live?.chrome.frames.contains { $0.contains(point) } ?? false)
    }
    live.capture.onChange = { [weak self, weak live] progress in
      guard let self, let live else { return }
      longScreenshotChanged(progress, in: live)
    }
    live.capture.onStop = { [weak self, weak live] _ in
      guard let self, let live else { return }
      longScreenshotStopped(live)
    }
    live.passThrough.onClickThrough = { [weak self] in self?.retakeKeyboard() }
    live.passThrough.onScroll = { [weak self] in self?.userScrolled($0) }
    live.passThrough.start()
  }

  /// The engine moved on: the size label, the bottom bar's auto-scroll label and the chrome.
  private func longScreenshotChanged(
    _ progress: LongScreenshotProgress, in live: CaptureLongScreenshot.Live
  ) {
    guard longScreenshot.live === live, case .longScreenshot(let rect) = phase else { return }
    show(rect, handles: false, label: longScreenshotLabel(height: progress.height, of: live))
    refreshBars()
    live.chrome.update(
      progress, message: message(for: progress),
      preview: live.capture.preview(fitting: live.previewSize))
  }

  /// What the status row says: a gap first, then a refused auto-scroll until one starts, then
  /// that the image can grow no further, then the page's end once it is in the image (also when
  /// the page was at its end from the start) with the part below the selection to add, else how
  /// to begin until the page moved.
  private func message(for progress: LongScreenshotProgress) -> LongScreenshotMessage? {
    if progress.lost != nil { return .lost }
    if longScreenshot.needsPermission { return .needsPermission }
    if progress.reachedLimit { return .limit }
    if progress.reachedEnd { return .end(tail: progress.tail) }
    if !progress.scrolled { return .start }
    return nil
  }

  /// "W × H · Long screenshot": the selection's width and the stitched height, in points; the
  /// selection's height before the first frame.
  private func longScreenshotLabel(height: CGFloat, of live: CaptureLongScreenshot.Live) -> String {
    let size = CGSize(
      width: live.selection.width, height: height > 0 ? height : live.selection.height)
    return ShellStrings.shared.text(
      LongScreenshotCaptureStringKey.sizeLabel,
      ScreenshotRules.sizeLabel(points: size, pixelWidth: nil, pixelHeight: nil))
  }

  /// The engine could not start, or the system stopped its stream (the screen-sharing menu's
  /// Stop, a display asleep): what the page showed while it scrolled is kept and finished as
  /// Done would; with nothing beyond the first frame, back to the screenshot with a beep.
  private func longScreenshotStopped(_ live: CaptureLongScreenshot.Live) {
    guard longScreenshot.live === live, !live.finishing else { return }
    if live.capture.progress.scrolled { return finishLongScreenshot() }
    NSSound.beep()
    leaveLongScreenshot()
  }

  /// A click went through the selection: the app under it became active and took the keyboard.
  /// The overlay, a non-activating panel, becomes key again without activating Atd, so Space,
  /// Return and Esc keep reaching it.
  private func retakeKeyboard() {
    guard case .longScreenshot(let rect) = phase, let owner = primaryOverlay(for: rect),
      let window = owner.window
    else { return }
    window.makeKey()
    window.makeFirstResponder(owner)
  }

  /// The user scrolled the app under the selection's scroll area; the engine hears of it, in
  /// points, positive towards the page's start (AppKit's sign, natural scrolling already applied).
  private func userScrolled(_ event: NSEvent) {
    guard case .longScreenshot(let rect) = phase, let live = longScreenshot.live,
      !live.finishing, let owner = primaryOverlay(for: rect), let window = owner.window
    else { return }
    let point = owner.convert(window.convertPoint(fromScreen: NSEvent.mouseLocation), from: nil)
    // Only scrolling over the band the page scrolls in counts: a wheel over a part of the
    // selection outside the scroll area moves nothing and would read as the page's end.
    let band = longScreenshot.answer(for: rect)?.area.map {
      live.selection.intersection(desktop.geometry.desktopRect($0.frame))
    }
    guard (band ?? live.selection).contains(point) else { return }
    let delta =
      event.hasPreciseScrollingDeltas
      ? event.scrollingDeltaY : event.scrollingDeltaY * Self.longScreenshotWheelLine
    if delta != 0 { live.capture.userScrolled(deltaY: delta) }
  }

  /// What the engine captures: `part` (the selection `rect` on `primary`) in that display's
  /// points, the scroll area found under `rect` there, and the app and window it lies over.
  private func longScreenshotTarget(
    for rect: CGRect, _ part: CGRect, on primary: CaptureDesktop.Display
  ) -> LongScreenshotCapture.Target {
    let geometry = desktop.geometry
    let display = geometry.frame(of: primary)
    let origin = primary.quartzFrame.origin
    let quartz = geometry.quartzRect(part)
    let center = CGPoint(x: quartz.midX, y: quartz.midY)
    let area = longScreenshot.answer(for: rect)?.area
    let snapshot = longScreenshot.snapshot
    let described = snapshot.describe(at: center)
    return LongScreenshotCapture.Target(
      displayID: primary.id, displayFrame: primary.quartzFrame,
      selection: part.offsetBy(dx: -display.minX, dy: -display.minY),
      scrollArea: area.map { $0.frame.offsetBy(dx: -origin.x, dy: -origin.y) },
      scrollValue: area?.verticalValue, pid: snapshot.pid(at: center), appName: described.app,
      windowTitle: described.window)
  }
}
