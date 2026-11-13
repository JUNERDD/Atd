import AICore
import AppKit

/// What idle offers besides the detected area (decisions E5, F3), and the bottom bar of every
/// phase (architecture C2, C3): `R` for the last region on the pointer's display, `W` for windows
/// only or elements again, and the bar's keys. Points are desktop points.
extension CaptureSession {
  /// The bar on `overlay`, nil where none shows. Idle: on every display, how to pick an area in
  /// targeting scope, `W` while limited to windows, `⌘A`, `R` while this display
  /// has a last region, and Esc. With a selection: only on the display holding most of it, what
  /// Return does in this mode and what Esc does; screenshots also name their quick-copy keys and,
  /// unless the selection is known not to offer it, ⌘↓ for the long screenshot. The long
  /// screenshot's live phase shows its keys alone (``longScreenshotBarKeys()``). None while a
  /// selection is pressed or dragged out.
  /// Each mode fits its visible hints; the recording bar reserves no space for screenshot copy.
  func barContent(on overlay: CaptureOverlayView) -> CaptureBar.Content? {
    let strings = ShellStrings.shared
    let pair = options.canRecord ? mode : nil
    switch phase {
    case .idle:
      let pick = [strings.text(.captureBarPickElement), strings.text(.captureBarPickWindow)]
      let detectsElements = detection == .elements && !onlyWindows
      var keys = [
        CaptureBarSegment(key: nil, label: pick[detectsElements ? 0 : 1], reserved: pick)
      ]
      if detection == .elements, onlyWindows {
        keys.append(CaptureBarSegment(key: "W", label: strings.text(.captureHintElements)))
      }
      keys.append(CaptureBarSegment(key: "⌘A", label: strings.text(.captureHintScreen)))
      if lastRegion(on: overlay) != nil {
        keys.append(CaptureBarSegment(key: "R", label: strings.text(.captureHintRecall)))
      }
      keys.append(CaptureBarSegment(key: "Esc", label: strings.text(.captureHintCancel)))
      return CaptureBar.Content(mode: pair, keys: keys)
    case .selected(let rect), .adjusting(.move(_, let rect)), .adjusting(.resize(_, let rect)):
      guard primaryOverlay(for: rect) === overlay else { return nil }
      let finish = strings.text(
        mode == .record ? .captureBarStartRecording : .captureBarFinishScreenshot)
      let back = strings.text(mode == .record ? .captureHintCancel : .captureHintBack)
      var keys = [
        CaptureBarSegment(key: "↵", label: finish),
        CaptureBarSegment(key: "Esc", label: back),
      ]
      if namesLongScreenshot(for: rect) {
        let long = strings.text(LongScreenshotCaptureStringKey.name)
        keys.insert(CaptureBarSegment(key: "⌘↓", label: long), at: 0)
      }
      if mode == .screenshot, let shortcut = options.copyShortcut {
        let copy = CaptureBarSegment(
          key: shortcut, label: strings.text(.captureBarCopyScreenshot))
        keys.insert(copy, at: 0)
      }
      return CaptureBar.Content(mode: pair, keys: keys)
    case .longScreenshot(let rect):
      guard primaryOverlay(for: rect) === overlay else { return nil }
      return CaptureBar.Content(mode: nil, keys: longScreenshotBarKeys())
    case .pressing, .creating, .adjusting(.create):
      return nil
    }
  }

  /// Every overlay's bar, placed for the selection of the moment.
  func refreshBars() {
    for overlay in overlays { refreshBar(on: overlay) }
  }

  func refreshBar(on overlay: CaptureOverlayView) {
    // During a move or a resize the bar stays where it was; the drag's end places it again.
    if case .adjusting = phase { return }
    let selection: CGRect? =
      switch phase {
      case .selected(let rect), .longScreenshot(let rect): rect
      case .idle, .pressing, .creating, .adjusting: nil
      }
    let content = barContent(on: overlay)
    // Either mode can request element detection while only windows are available, before a
    // selection, clickable once per launch.
    let request: Bool? =
      if content != nil, case .idle = phase, detection == .windowsOnly {
        offersTrustRequest
      } else {
        nil
      }
    overlay.showBar(content, selection: selection, trustRequest: request)
  }

  /// What the bars beside `rect` keep clear of: the bottom bar and the size label on the display
  /// holding most of it, where they sit.
  func keepClear(for rect: CGRect) -> AnnotationToolbarLayout.KeepClear {
    let owner = primaryOverlay(for: rect)
    return AnnotationToolbarLayout.KeepClear(bar: owner?.barFrame, label: owner?.sizeLabelFrame)
  }

  /// The Accessibility request was clicked: the caller asks for trust once the overlays are gone.
  func requestAccessibility() {
    guard offersTrustRequest, detection == .windowsOnly, case .idle = phase else { return }
    finish(.wantsAccessibility)
  }

  // MARK: Recall and windows only

  /// The region last confirmed mostly on `overlay`'s display (desktop points), while that
  /// display keeps its frame. A region that spanned displays comes back across them.
  func lastRegion(on overlay: CaptureOverlayView) -> CGRect? {
    regions.region(
      displayID: overlay.display.displayID, displayFrame: overlay.display.quartzFrame
    )?.offsetBy(dx: overlay.bounds.minX, dy: overlay.bounds.minY)
  }

  /// `R` in idle: the pointer's display's last region becomes the selection.
  func recallRegion() {
    guard case .idle = phase, let owner = pointer?.overlay, let region = lastRegion(on: owner)
    else { return }
    commit(model.settled(region))
  }

  /// `W` in idle: candidates shrink to the window and the display, or grow back to elements.
  /// Only meaningful while elements are detected.
  func toggleWindowsOnly() {
    guard case .idle = phase, detection == .elements else { return }
    onlyWindows.toggle()
    resetChain()
    refreshBars()
    renderIdle()
    requestHover()
  }
}
