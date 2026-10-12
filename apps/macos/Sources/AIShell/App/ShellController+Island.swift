import AICore
import AppKit

/// The command island's ties to the rest of the shell: the shortcuts' hold, which summons
/// through ``Summoner``, the cards handing the keyboard back to the field the command came from,
/// and the compose card's attaching.
extension ShellController {
  func makeShortcutHolds() -> ShortcutHolds {
    ShortcutHolds(
      catalog: { [weak self] in self?.commandOptions ?? CommandOptionsCatalog() },
      summon: { [weak self] trigger, held in
        self?.summoner.summon(trigger, held: held) ?? false
      },
      progress: commandProgress)
  }

  /// The compose card attaches as the page's calls do: a screenshot through the capture
  /// `screenshot.capture` runs, under its conditions (refused while the panel is still opening
  /// or a dialog is open), and files through the chooser and import `files.pick` runs; a refused
  /// screenshot's note opens the Screen Recording pane as the welcome guide does.
  func composeAttachments() -> ComposeAttachments {
    ComposeAttachments(
      screenshot: { [weak self] () async throws(BridgeError) -> ScreenshotCaptureResult in
        guard let self else { return .notOk(.init(reason: .cancelled)) }
        return try await captureScreenshot()
      },
      pickFiles: { [weak self] () async throws(BridgeError) -> [FileRef] in
        guard let self else { return [] }
        return try await attachments.pick()
      },
      openScreenRecordingSettings: { [weak self] in self?.screenRecording.openSystemSettings() })
  }

  /// The answer card's Insert or Replace: the app the person works in takes the keyboard back
  /// from the card, its focused field is captured afresh as a summon captures it, and the
  /// answer is written there as `text.write` writes, with the person's typing settings.
  func writeAnswer(_ answer: String, mode: TextWriteParams.Mode) async -> AnswerWriteOutcome {
    let front = NSWorkspace.shared.frontmostApplication.flatMap {
      $0 == NSRunningApplication.current ? nil : $0
    }
    let app = front?.localizedName ?? front?.bundleIdentifier ?? ""
    func refused(_ reason: TextWriteResult.NotOk.Reason) -> AnswerWriteOutcome {
      AnswerWriteOutcome(result: .notOk(.init(reason: reason)), app: app)
    }
    guard SelectionReader.isTrusted else { return refused(.notTrusted) }
    guard let front, await TextWriter.bringForward(front, reassert: true) else {
      return refused(.targetGone)
    }
    guard let target = await summoner.writeTargets.capture(after: .unread) else {
      return refused(.targetGone)
    }
    guard target.writable else { return refused(.failed) }
    let writeTargets = summoner.writeTargets
    let result = await writeText(
      TextWriteParams(
        target: target.id, mode: mode, text: answer, typing: writeTargets.typesAnswers,
        animation: writeTargets.animatesTyping))
    return AnswerWriteOutcome(result: result, app: target.app)
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
