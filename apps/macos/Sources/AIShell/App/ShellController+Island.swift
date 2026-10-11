import AICore
import AppKit

/// The command island's ties to the rest of the shell: the shortcuts' hold, which summons
/// through ``Summoner``, and the options card handing the keyboard back to the field the command
/// came from.
extension ShellController {
  func makeShortcutHolds() -> ShortcutHolds {
    ShortcutHolds(
      catalog: { [weak self] in self?.commandOptions ?? CommandOptionsCatalog() },
      summon: { [weak self] trigger, held in
        self?.summoner.summon(trigger, held: held) ?? false
      },
      progress: commandProgress)
  }

  /// A card closed (the options card without running, the answer card): the field the command
  /// was summoned from gets the keyboard back, its selection as it was
  /// (``TextWriter/returnFocus(to:)``). A target that expired, a capture session or file dialog
  /// in front, or another app the person moved to meanwhile (the answer card stays when its
  /// window gives up the keyboard) leaves the keyboard where it is.
  func returnFocus(to targetID: String) {
    guard !screenshots.isCapturing, !systemPanels.isOpen,
      let target = summoner.writeTargets.target(targetID),
      NSWorkspace.shared.frontmostApplication?.processIdentifier == target.pid
    else { return }
    Task { await TextWriter.returnFocus(to: target) }
  }
}
