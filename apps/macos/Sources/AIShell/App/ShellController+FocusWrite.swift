import AICore
import AppKit

/// Writes where the person's focus is now rather than into a recorded target: the island's
/// answer card (``writeAnswer(_:mode:)``) and the task panel's write buttons (`text.writeFocused`,
/// which follow ``PanelFocus``) share one path, which captures the field afresh at the press.
extension ShellController {
  /// `text.writeFocused`: into the focused field of the frontmost app other than Atd, or of the
  /// last one while Atd is frontmost, with the page's typing settings.
  func writeFocused(_ params: TextWriteFocusedParams) async -> TextWriteFocusedResult {
    let outcome = await write(
      params.text, mode: TextWriteParams.Mode(params.mode), into: panelFocus.app,
      typing: params.typing, animation: params.animation)
    return TextWriteFocusedResult(outcome.result)
  }

  /// `app` takes the keyboard (back from a non-activating card, or from Atd itself), its focused
  /// field is captured afresh as a summon captures it, and `text` is written there as
  /// `text.write` writes: the outcome, with the name of the app it wrote into (or tried to). A
  /// capture session or an open file dialog owns the screen and the keyboard, so nothing moves
  /// then. A selection mode reads the selection first, as a command launch does: opaque editors
  /// need its copy fallback, and an AX-only capture would lose both the text and its cell type.
  func write(
    _ text: String, mode: TextWriteParams.Mode, into app: NSRunningApplication?, typing: Bool,
    animation: Bool
  ) async -> AnswerWriteOutcome {
    let name = app?.localizedName ?? app?.bundleIdentifier ?? ""
    func refused(_ reason: TextWriteResult.NotOk.Reason) -> AnswerWriteOutcome {
      AnswerWriteOutcome(result: .notOk(.init(reason: reason)), app: name)
    }
    guard !screenshots.isCapturing, !systemPanels.isOpen else { return refused(.failed) }
    guard SelectionReader.isTrusted else { return refused(.notTrusted) }
    guard let app, await TextWriter.bringForward(app, reassert: true) else {
      return refused(.targetGone)
    }
    let selection = mode == .cursor ? SummonSelection.unread : await summoner.readSelection()
    guard let target = await summoner.writeTargets.capture(after: selection) else {
      return refused(.targetGone)
    }
    guard target.writable else { return refused(.failed) }
    let result = await writeText(
      TextWriteParams(
        target: target.id, mode: mode, text: text, typing: typing, animation: animation))
    return AnswerWriteOutcome(result: result, app: target.app)
  }
}

extension TextWriteParams.Mode {
  fileprivate init(_ mode: TextWriteFocusedParams.Mode) {
    switch mode {
    case .selection: self = .selection
    case .afterSelection: self = .afterSelection
    case .cursor: self = .cursor
    }
  }
}

/// `text.writeFocused` answers as `text.write` does; the generated types are separate enums.
extension TextWriteFocusedResult {
  fileprivate init(_ result: TextWriteResult) {
    switch result {
    case .ok: self = .ok(.init())
    case .notOk(let refusal):
      let reason: NotOk.Reason =
        switch refusal.reason {
        case .notTrusted: .notTrusted
        case .targetGone: .targetGone
        case .targetChanged: .targetChanged
        case .noSelection: .noSelection
        case .secureInput: .secureInput
        case .failed: .failed
        case .interrupted: .interrupted
        case .unsupportedSelection: .unsupportedSelection
        }
      self = .notOk(.init(reason: reason))
    }
  }
}
