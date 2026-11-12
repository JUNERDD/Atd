import AICore
import AppKit

/// What the long screenshot's full-screen preview needs from the rest of the shell to work on the
/// image's text (the plan's 「长截图的全屏预览」): the commands placed on screenshot text and their
/// options menus, the runner they run on (``CaptureTextRunner``), the files each run reads, and
/// the clipboard. Its orchestrator makes it (``LongScreenshotController/textServices``); every
/// member answers as things stand when it is called, so a command list pushed while the preview
/// is open shows at once. Without the screenshot capability wired in, the commands are empty and
/// the preview offers Copy alone.
struct LongScreenshotTextServices {
  /// The commands placed on `screenshotText` that read the selection, in order
  /// (`screenshotToolbar.set`'s `textCommands`).
  var commands: () -> [SelectionToolbarSettings.Command] = { [] }
  /// Their options (`commandOptions.set`); a command without an entry has no options menu.
  var catalog: () -> CommandOptionsCatalog = { CommandOptionsCatalog() }
  /// A command's option values picked in a menu, to remember (`commandOptions.picked`).
  var onPick: (String, CommandArguments) -> Void = { _, _ in }
  /// Runs the commands; nil before the shell made it.
  var runner: () -> CaptureTextRunner? = { nil }
  /// Writes `kept` as the image a run reads (as the preview shows it, with what is on it) and its
  /// context, into a folder of their own; nil when they could not be written.
  var files: (LongScreenshotKept) async -> CaptureTextRunner.Files? = { _ in nil }
  /// Puts `kept` on the clipboard as an image and answers its size in points; nil when it could
  /// not be (the export failed, the clipboard is busy, or another long screenshot took over).
  var copyImage: (LongScreenshotKept) async -> CGSize? = { _ in nil }
  /// Puts recognized text on the clipboard; false while another owner holds it.
  var copyText: (String) -> Bool = { _ in false }
}
