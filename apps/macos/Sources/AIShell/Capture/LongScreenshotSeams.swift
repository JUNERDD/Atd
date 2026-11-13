import AICore
import AppKit

// The seams between the capture session's long screenshot phase and its neighbours: the chrome
// it hosts beside the selection, and where a finished long screenshot goes.

/// The live phase's chrome beside the selection: the preview strip, and the control bar (grip,
/// auto-scroll, screens captured, back, done) with the status row as its second row. It stays
/// where it was placed while the page scrolls; only dragging the bar moves the bar and its row.
protocol LongScreenshotChromeHosting: AnyObject {
  /// The auto-scroll toggle (Space does the same through the session).
  var onAutoScroll: (() -> Void)? { get set }
  /// Back to the screenshot (Esc).
  var onBack: (() -> Void)? { get set }
  /// Finish (Return).
  var onDone: (() -> Void)? { get set }
  /// Add or remove the scroll area's part below the selection, offered at the page's end.
  var onTail: (() -> Void)? { get set }

  /// Adds the chrome to `host` (an overlay's annotation host, flipped desktop points) beside
  /// `selection`, keeping clear of the bottom bar and the size label as the annotation toolbar
  /// does.
  func show(in host: NSView, selection: CGRect, keepClear: AnnotationToolbarLayout.KeepClear)
  /// Shows the phase as it is now; `preview` is the stitched image scaled for the strip.
  func update(
    _ progress: LongScreenshotProgress, message: LongScreenshotMessage?, preview: CGImage?)
  /// Takes the chrome off its host and drops its images.
  func remove()
  /// The chrome's frames in host coordinates, which take presses that must not reach the app.
  var frames: [CGRect] { get }
}

/// Where a finished long screenshot goes: the island's result card and its orchestrator. Called
/// after the capture session ended and its screen claim was released.
protocol LongScreenshotResults: AnyObject {
  func show(_ shot: LongScreenshotImage)
}
