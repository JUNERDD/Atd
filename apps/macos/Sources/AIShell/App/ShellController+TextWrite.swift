import AICore

/// `text.write`: a command's answer written back into the field it was summoned from, which the
/// summon recorded (``Summoner/writeTargets``) and ``TextWriter`` restores and pastes into.
extension ShellController {
  /// A capture session or an open file dialog owns the screen and the keyboard, so the write
  /// fails then without changing anything. The target's island turns to "Writing…" first,
  /// which also gives Escape back before keys go to the app, then to "Written" once the answer
  /// is in; an island of another target stays as it is (``CommandProgressController/showWriting(target:)``).
  /// A refused or failed write takes away only the target's own island, and the page shows its
  /// notice.
  func writeText(_ params: TextWriteParams) async -> TextWriteResult {
    guard !screenshots.isCapturing, !systemPanels.isOpen else {
      commandProgress.hide(target: params.target)
      return .notOk(.init(reason: .failed))
    }
    commandProgress.showWriting(target: params.target)
    let target = summoner.writeTargets.target(params.target)
    if let target, params.animation { summoner.writeTargets.writing(target) }
    let result = await TextWriter.write(params, to: target, arbiter: deviceArbiter) {
      hidePanel()
    }
    if let target { summoner.writeTargets.wrote(target) }
    if case .ok = result {
      commandProgress.showDone(target: params.target)
    } else {
      commandProgress.hide(target: params.target)
    }
    return result
  }
}
