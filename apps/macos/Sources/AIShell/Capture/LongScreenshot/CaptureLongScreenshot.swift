import AICore
import AppKit

/// What a capture session keeps for the long screenshot (``CaptureSession+LongScreenshot.swift``):
/// the windows on screen when it started, the scroll areas Accessibility found under its
/// selections, and the live phase while it runs. ``end()`` drops all of it with the session, so
/// no stitched pixels, preview or monitor outlives it.
final class CaptureLongScreenshot {
  /// The live phase: the engine stitching the selection, its chrome beside the selection, and the
  /// monitors that keep the keyboard and see the user's scrolling while input passes through.
  final class Live {
    /// The selection in desktop points, within one display.
    let selection: CGRect
    let capture: LongScreenshotCapture
    let chrome: any LongScreenshotChromeHosting
    let passThrough = LongScreenshotPassThrough()
    /// The size, in points, the chrome's preview strip shows the stitched image at; set once the
    /// chrome is shown.
    var previewSize = CGSize.zero
    /// Done was asked for: the engine is putting the image together, and input waits for it.
    var finishing = false
    /// The engine handed its image over; there is nothing left to cancel.
    var finished = false

    init(
      selection: CGRect, capture: LongScreenshotCapture, chrome: any LongScreenshotChromeHosting
    ) {
      self.selection = selection
      self.capture = capture
      self.chrome = chrome
    }

    /// Removes the monitors and the chrome and stops the engine unless it finished.
    fileprivate func stop() {
      passThrough.stop()
      chrome.remove()
      capture.onChange = nil
      capture.onStop = nil
      if !finished { capture.cancel() }
    }
  }

  /// What Accessibility found under one selection (desktop points): nil when nothing scrolls.
  struct Answer {
    let selection: CGRect
    let area: LongScreenshotScrollArea?
  }

  /// How many answers are kept, the latest last; going back to a recent selection, as Esc from
  /// the live phase does, never asks again.
  private static let kept = 8

  /// The windows on screen when the session started, before any overlay: they name the app the
  /// selection lies over.
  var snapshot = WindowSnapshot(entries: [])
  /// The probe in flight, for the selection of the moment.
  var probe: Task<Void, Never>?
  private var answers: [Answer] = []
  private(set) var live: Live?
  /// Auto-scroll was refused for its permission: the status row says so until it next starts.
  var needsPermission = false
  /// The bottom bar named ⌘↓ for the last selection whose answer was known; it keeps doing so
  /// while a moved selection is looked at again.
  var namedInBar = false
  /// Accessibility is to be asked for once the overlays are gone, as the Accessibility hint's
  /// request is: the system's prompt would open beneath them.
  var asksForTrust = false

  /// The answer for `selection`, nil while none is known.
  func answer(for selection: CGRect) -> Answer? {
    answers.last { $0.selection == selection }
  }

  func remember(_ area: LongScreenshotScrollArea?, under selection: CGRect) {
    answers.removeAll { $0.selection == selection }
    answers.append(Answer(selection: selection, area: area))
    if answers.count > Self.kept { answers.removeFirst() }
  }

  func begin(_ live: Live) {
    endLive()
    self.live = live
  }

  /// Ends the live phase, if one runs. Its callbacks stop reaching the session first, so nothing
  /// the engine reports while it stops is taken for the phase.
  func endLive() {
    guard let live else { return }
    self.live = nil
    live.stop()
  }

  /// The session ended.
  func end() {
    probe?.cancel()
    probe = nil
    endLive()
    answers = []
  }
}
