import AICore
import AppKit

/// What the full-screen preview's text controls do (the plan's 「长截图的全屏预览」): Select Text
/// and Done, the text command row's commands, its options menus and its Copy, and the bottom
/// bar's Cover Sensitive Info.
extension IslandLongScreenshotLightbox {
  /// The commands the row offers now (`screenshotToolbar.set`'s `textCommands`).
  var textCommands: [SelectionToolbarSettings.Command] { services.commands() }

  /// Select Text, or Done in text mode.
  func toggleTextMode() { setMode(mode == .text ? .view : .text) }

  /// A command button: `command` runs on the picked text, or all of it, with the values its
  /// options menu picked (`arguments`), else its remembered ones; the side panel shows its card.
  func run(_ command: SelectionToolbarSettings.Command, arguments: CommandArguments? = nil) {
    menus.close()
    annotator.finish()
    results.run(command, arguments: arguments)
    if results.model.card != nil { panel.open() }
  }

  /// A command launched from its options menu.
  func run(_ launch: CommandLaunch) {
    guard let command = textCommands.first(where: { $0.id == launch.id }) else { return }
    run(command, arguments: launch.arguments)
  }

  /// The row's Copy, or ⌘C with picks: the picked paragraphs' recognized text (all of it without
  /// picks), never a masked paragraph's; its button says how many went.
  func copyText() {
    let count = text.readingOrder.count
    guard count > 0, services.copyText(text.selectionText) else { return NSSound.beep() }
    text.confirmCopy(count)
  }

  /// The bottom bar's Cover Sensitive Info (decision D7): the mosaic tool's auto-redact, as one
  /// undo step, in the mosaic tool's remembered style; its button confirms.
  func redactSensitive() {
    annotator.redactSensitive(fromStyleBar: false)
  }

  /// Whether Cover Sensitive Info shows: while sensitive items in the kept range have no mosaic
  /// over them, or while it confirms.
  var offersRedaction: Bool {
    card.redacted != nil || !card.state.unmaskedSensitive.isEmpty
  }
}
