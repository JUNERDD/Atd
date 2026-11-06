import AICore
import AppKit

/// What idle offers besides the detected area (decisions E5, F3): the hints, `R` for the last
/// region on the pointer's display and `W` for windows only. Points are desktop points.
extension CaptureSession {
  /// The hint lines of `overlay`, the first one lowest. Idle: one line of how to pick an area
  /// (`W`'s status and key only once it chose windows only, `R` only while this display has a
  /// last region), and while detection offers only windows, at index 1 the Accessibility hint
  /// (``isTrustRequest(_:on:)`` relies on that place). Once a selection exists: one line of how
  /// to adjust and confirm it, on the display holding most of it; there `⌘A` appears when it
  /// is exactly one of several displays, the step that takes it to every display.
  func hintLines(on overlay: CaptureOverlayView) -> [CaptureHintLine] {
    let strings = ShellStrings.shared
    func segment(_ key: String?, _ text: CaptureHintStringKey, rank: Int = 0)
      -> CaptureHintSegment
    {
      CaptureHintSegment(key: key, label: strings.text(text), rank: rank)
    }
    switch phase {
    case .idle:
      var line = [segment(nil, .captureHintPick)]
      if onlyWindows {
        line += [
          segment(nil, .captureHintWindowsOnly, rank: 1),
          segment("W", .captureHintElements, rank: 1),
        ]
      }
      line.append(segment(nil, .captureHintScroll, rank: 4))
      line.append(segment("⌘A", .captureHintScreen, rank: 2))
      if lastRegion(on: overlay) != nil { line.append(segment("R", .captureHintRecall, rank: 3)) }
      line.append(segment("Esc", .captureHintCancel))
      return detection == .windowsOnly ? [line, [segment(nil, .captureHintAccessibility)]] : [line]
    case .selected(let rect), .adjusting(.move(_, let rect)), .adjusting(.resize(_, let rect)):
      guard primaryOverlay(for: rect) === overlay else { return [] }
      var line = [segment(nil, .captureHintResize, rank: 2), segment("↵", .captureHintConfirm)]
      if overlays.count > 1, rect == wholeDisplay(holding: rect, fallback: overlay.bounds) {
        line.append(segment("⌘A", .captureHintAllDisplays, rank: 1))
      }
      line.append(segment("Esc", .captureHintBack))
      return [line]
    case .pressing, .creating, .adjusting(.create):
      return []
    }
  }

  func refreshHints() {
    for overlay in overlays {
      overlay.showHints(hintLines(on: overlay), avoiding: hintClearance(on: overlay))
    }
  }

  /// The band a hint must stay out of on `overlay`: the selection's rows with room for its size
  /// label and the annotation bars (toolbar, gap, style bar), which can sit above or below it and
  /// wider than it. Re-placed when a selection drag ends (`move`); while one runs, the hint stays.
  private func hintClearance(on overlay: CaptureOverlayView) -> CGRect? {
    guard case .selected(let rect) = phase, primaryOverlay(for: rect) === overlay else {
      return nil
    }
    let reach = AnnotationToolbarLayout.sizeLabelReach + 8 + 40 + 6 + 40
    return CGRect(
      x: overlay.bounds.minX, y: rect.minY - reach, width: overlay.bounds.width,
      height: rect.height + reach * 2)
  }

  /// Whether a press at `point` is on the Accessibility hint while it can still ask for trust.
  func isTrustRequest(_ point: CGPoint, on overlay: CaptureOverlayView) -> Bool {
    offersTrustRequest && detection == .windowsOnly && overlay.hint(1, contains: point)
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
    refreshHints()
    renderIdle()
    requestHover()
  }
}
