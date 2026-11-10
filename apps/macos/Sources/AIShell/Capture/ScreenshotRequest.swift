import AICore
import Foundation

/// A caller must choose the capture's purpose; omitting options cannot silently select an
/// image-only session for a general capture entry.
enum ScreenshotRequest: Equatable {
  /// Composer, global capture shortcuts and mini panel: commands, questions and recording.
  case capture(CaptureMode)
  /// An image for an existing command or attachment destination, or an image being edited.
  case image

  var toolbar: Bool {
    if case .capture = self { true } else { false }
  }

  var mode: CaptureMode {
    switch self {
    case .capture(let mode): mode
    case .image: .screenshot
    }
  }
}

/// How a ``ScreenshotRequest`` ended, in the shell's terms; the bridge maps it to
/// `screenshot.capture`'s result.
enum ScreenshotOutcome {
  /// The capture was imported (``ScreenshotAttachment``).
  case attached(ScreenshotAttachment)
  /// Cancelled, or copied to the clipboard: nothing to attach.
  case cancelled
  /// Screen Recording is not granted; the prompt was asked for.
  case notPermitted
  /// The selection went to a recording: nothing was imported, the page adds and shows nothing.
  case recording
  /// The selection became a long screenshot, which the island's result card shows and hands on:
  /// nothing was imported, and the page adds and shows nothing either.
  case longScreenshot
}

/// An imported capture and what to do with it.
struct ScreenshotAttachment {
  let file: FileRef
  /// The screen context imported with it, when anything was known about the screen.
  let context: FileRef?
  /// When the screen was frozen (`CapturedText.timestamp`).
  let capturedAt: String
  /// A command or a question launched from the command row; nil for a plain confirm.
  let launch: CaptureLaunch?
  /// The field focused in the app in front before the capture, for a command that inserts its
  /// answer at the cursor: recorded only for a `toolbar` request, and given only with a launch.
  let target: ShortcutCommandEvent.Target?
}
