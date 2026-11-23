import AICore
import AppKit

/// Whether a screenshot selection offers the long screenshot (decisions D5, D10). Only a session
/// that offers it at all does (``CaptureSessionOptions/offersLongScreenshot``: a toolbar request),
/// in screenshot mode, for a selection on one display that is at least
/// ``LongScreenshotGeometry/minimumBand`` both ways: the band the engine compares between frames,
/// whatever Accessibility says. Without Accessibility nothing can say the selection does not
/// scroll, so it is offered: scrolling by hand needs no permission. With it, Accessibility looks
/// for a scroll area under every settled selection, beside the text reading, and the answer is
/// kept per selection; only an answer that shows nothing scrolls there withholds it, and one that
/// cannot tell offers it as without Accessibility. The toolbar's button and the bottom bar's ⌘↓
/// show the answer; ⌘↓ beeps while it is not `.available`.
extension CaptureSession {
  /// The session offers the long screenshot in its current mode.
  var offersLongScreenshot: Bool { options.offersLongScreenshot && mode == .screenshot }

  /// Whether `rect` is at least ``LongScreenshotGeometry/minimumBand`` both ways. A shorter band
  /// cannot follow the page: frames must overlap by ``LongScreenshotMatcher/minimumOverlap`` rows
  /// to match, so the image would never grow past the selection.
  static func holdsLongScreenshotBand(_ rect: CGRect) -> Bool {
    let minimum = LongScreenshotGeometry.minimumBand
    return !rect.isNull && rect.width >= minimum && rect.height >= minimum
  }

  /// What the toolbar's button shows for the selection `rect`; nil hides it.
  func longScreenshotAvailability(for rect: CGRect) -> LongScreenshotAvailability? {
    guard offersLongScreenshot else { return nil }
    let displays = desktop.geometry.displays(overlapping: rect).count
    guard displays <= 1 else { return .spansDisplays }
    guard displays == 1 else { return .notScrollable }
    guard Self.holdsLongScreenshotBand(rect) else { return .tooSmall }
    switch detection {
    case nil:
      return .checking
    case .windowsOnly:
      return .available
    case .elements:
      guard let answer = longScreenshot.answer(for: rect) else { return .checking }
      switch answer.probe {
      case .unknown: return .available
      case .none: return .notScrollable
      case .area(let area):
        let overlap = area.frame.intersection(desktop.geometry.quartzRect(rect))
        return Self.holdsLongScreenshotBand(overlap) ? .available : .notScrollable
      }
    }
  }

  /// What the toolbar button shows for `rect`, holding the previous settled state across
  /// `.checking` while a moved or resized selection is probed again so neither the button nor the
  /// bottom bar flickers.
  func displayedLongScreenshotAvailability(for rect: CGRect) -> LongScreenshotAvailability? {
    let actual = longScreenshotAvailability(for: rect)
    switch actual {
    case .available, .notScrollable:
      longScreenshot.lastSettled = actual
      return actual
    case .spansDisplays, .tooSmall, nil:
      longScreenshot.lastSettled = nil
      return actual
    case .checking:
      return longScreenshot.lastSettled ?? .checking
    }
  }

  /// Whether the bottom bar names ⌘↓ for `rect`: while the selection is looked at again, as it
  /// did for the selection before, so the bar does not grow and shrink on every move or nudge.
  func namesLongScreenshot(for rect: CGRect) -> Bool {
    displayedLongScreenshotAvailability(for: rect) == .available
  }

  /// Looks for the scroll area under `rect` once it stayed put for `delay`, unless it is known,
  /// replacing a probe still running, and shows the answer. Only while elements are detected and
  /// the selection could be offered at all: otherwise the availability needs no probe.
  func probeScrollArea(in rect: CGRect, after delay: Duration = .zero) {
    longScreenshot.probe?.cancel()
    longScreenshot.probe = nil
    longScreenshot.startWhenReady = false
    defer { showLongScreenshotAvailability() }
    guard offersLongScreenshot, detection == .elements, longScreenshot.answer(for: rect) == nil,
      desktop.geometry.displays(overlapping: rect).count == 1, Self.holdsLongScreenshotBand(rect)
    else { return }
    let quartz = desktop.geometry.quartzRect(rect)
    let targeting = targeting
    longScreenshot.probe = Task { [weak self] in
      if delay > .zero { try? await Task.sleep(for: delay) }
      guard !Task.isCancelled else { return }
      let probe = await targeting.scrollArea(around: quartz)
      guard !Task.isCancelled, let self, !isFinished else { return }
      longScreenshot.probe = nil
      longScreenshot.remember(probe, under: rect)
      showLongScreenshotAvailability()
    }
  }

  /// The toolbar's button and the bottom bar for the selection as it is now.
  func showLongScreenshotAvailability() {
    guard case .selected(let rect) = phase else { return }
    editor?.longScreenshot = displayedLongScreenshotAvailability(for: rect)
    refreshBars()
    let clear = keepClear(for: rect)
    if editor?.keepClear != clear {
      editor?.keepClear = clear
      editor?.selectionDidChange(rect, dragging: isAdjusting)
    }
    if longScreenshot.startWhenReady, longScreenshotAvailability(for: rect) != .checking {
      longScreenshot.startWhenReady = false
      startLongScreenshot()
    }
  }
}
