import AppKit
import CoreGraphics

// The seam between a capture session in record mode and the recording that follows it. The
// session owns selection, overlays and placement; the record bar (``CaptureRecordAccessory``)
// only renders the sound and options menus and Start beside the selection; once the user starts,
// the session ends with a ``CaptureRecordRequest`` and the overlays close before
// ``CaptureRecording/begin(_:)`` runs, so the recording sees the live screen, not the frozen one.

/// A region the user chose to record. Recording is clamped to one display: the one holding most
/// of the selection.
nonisolated struct CaptureRecordRequest: Equatable, Sendable {
  /// The display recorded.
  let displayID: CGDirectDisplayID
  /// That display's Quartz frame (global points, origin at the primary display's top-left, y down).
  let displayFrame: CGRect
  /// The region to record in that display's points (origin at its top-left, y down), within it.
  let rect: CGRect
  /// The window the selection was committed from, when the selection is exactly a detected window.
  let windowID: CGWindowID?
  /// The app owning the window under the selection when the session started, for the result's
  /// title; nil when none is known.
  let appName: String?
  let bundleID: String?
}

/// The record-mode bar beside a committed selection: Sound ⌄, Options ⌄, cancel and Start. The
/// session sizes and places it exactly as it places the annotation toolbar (below, above, beside
/// the bottom bar, else inside), and hosts it on the overlay holding most of the selection. It is
/// built on ``AnnotationGlassBar`` so ``AnnotationHostView`` lets presses reach its controls.
/// Its settings are remembered as they change; the recording reads them when it starts.
@MainActor protocol CaptureRecordAccessory: AnyObject {
  /// The user pressed Start: the session ends with `record`.
  var onStart: (() -> Void)? { get set }
  /// The user cancelled from the bar: the session cancels.
  var onCancel: (() -> Void)? { get set }
  /// The bar's size in points. Constant while shown: its controls reserve their widest value.
  var size: CGSize { get }
  /// Adds the bar to `host`, or moves it there, at `frame` (that host's points, which are desktop
  /// points).
  func place(in host: AnnotationHostView, frame: CGRect)
  /// True while one of its menus or its folder panel is open: the session leaves the keyboard and
  /// presses outside the bar to it.
  var isModal: Bool { get }
  /// Escape: closes the deepest open menu and answers true, or answers false so the session steps
  /// back as it does in screenshot mode.
  func dismissMenus() -> Bool
  /// Removes the bar and closes its menus.
  func hide()
}

/// Takes over a record-mode selection once its capture session has ended.
@MainActor protocol CaptureRecording: AnyObject {
  /// Counting down, recording, paused, confirming a discard or processing: a capture session and
  /// a second recording are refused meanwhile.
  var isBusy: Bool { get }
  /// Starts the recording of `request` with the remembered recording settings.
  func begin(_ request: CaptureRecordRequest)
}
