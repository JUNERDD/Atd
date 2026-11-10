import AICore
import AppKit

/// Whether a screenshot selection offers the long screenshot (decisions D5, D10). Only a session
/// that offers it at all does (``CaptureSessionOptions/offersLongScreenshot``: a toolbar request),
/// in screenshot mode, for a selection on one display. Without Accessibility nothing can say the
/// selection does not scroll, so it is offered: scrolling by hand needs no permission. With it,
/// Accessibility looks for a scroll area under every settled selection, beside the text reading,
/// and the answer is kept per selection. The toolbar's button and the bottom bar's ⌘↓ show the
/// answer; ⌘↓ beeps while it is not `.available`.
extension CaptureSession {
  /// How far a scroll area must overlap the selection both ways for it to count.
  static let longScreenshotOverlap: CGFloat = 48

  /// The session offers the long screenshot in its current mode.
  var offersLongScreenshot: Bool { options.offersLongScreenshot && mode == .screenshot }

  /// What the toolbar's button shows for the selection `rect`; nil hides it.
  func longScreenshotAvailability(for rect: CGRect) -> LongScreenshotAvailability? {
    guard offersLongScreenshot else { return nil }
    let displays = desktop.geometry.displays(overlapping: rect).count
    guard displays <= 1 else { return .spansDisplays }
    guard displays == 1 else { return .notScrollable }
    switch detection {
    case nil:
      return .checking
    case .windowsOnly:
      return .available
    case .elements:
      guard let answer = longScreenshot.answer(for: rect) else { return .checking }
      guard let frame = answer.area?.frame else { return .notScrollable }
      let overlap = frame.intersection(desktop.geometry.quartzRect(rect))
      let minimum = Self.longScreenshotOverlap
      return overlap.width >= minimum && overlap.height >= minimum ? .available : .notScrollable
    }
  }

  /// Whether the bottom bar names ⌘↓ for `rect`: while the selection is looked at again, as it
  /// did for the selection before, so the bar does not grow and shrink on every move or nudge.
  func namesLongScreenshot(for rect: CGRect) -> Bool {
    switch longScreenshotAvailability(for: rect) {
    case .available: longScreenshot.namedInBar = true
    case .notScrollable, .spansDisplays, nil: longScreenshot.namedInBar = false
    case .checking: break
    }
    return longScreenshot.namedInBar
  }

  /// Looks for the scroll area under `rect` once it stayed put for `delay`, unless it is known,
  /// replacing a probe still running, and shows the answer. Only while elements are detected:
  /// otherwise the availability needs no probe.
  func probeScrollArea(in rect: CGRect, after delay: Duration = .zero) {
    longScreenshot.probe?.cancel()
    longScreenshot.probe = nil
    defer { showLongScreenshotAvailability() }
    guard offersLongScreenshot, detection == .elements, longScreenshot.answer(for: rect) == nil,
      desktop.geometry.displays(overlapping: rect).count == 1
    else { return }
    let quartz = desktop.geometry.quartzRect(rect)
    let targeting = targeting
    longScreenshot.probe = Task { [weak self] in
      if delay > .zero { try? await Task.sleep(for: delay) }
      guard !Task.isCancelled else { return }
      let area = await targeting.scrollArea(around: quartz)
      guard !Task.isCancelled, let self, !isFinished else { return }
      longScreenshot.probe = nil
      longScreenshot.remember(area, under: rect)
      showLongScreenshotAvailability()
    }
  }

  /// The toolbar's button and the bottom bar for the selection as it is now.
  func showLongScreenshotAvailability() {
    guard case .selected(let rect) = phase else { return }
    editor?.longScreenshot = longScreenshotAvailability(for: rect)
    refreshBars()
  }
}
