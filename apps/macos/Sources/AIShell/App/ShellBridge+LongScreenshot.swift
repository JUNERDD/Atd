import AICore

/// The bridge's long screenshot routes: the answers to its result card's asks come back on the
/// recording's `recording.answer`, told apart by their `source` (``ShellBridge``'s dispatch).
extension ShellBridge {
  /// `recording.answer` for a long screenshot's ask, as it grows, for its result card.
  static func answerLongScreenshot(_ params: RecordingAnswerParams, shell: ShellController) {
    let phase: RecordingAnswer.Phase =
      switch params.state {
      case .thinking: .thinking
      case .streaming: .streaming
      case .done: .done
      case .stopped: .stopped
      case .failed: .failed
      }
    shell.installedLongScreenshots?.updateAnswer(
      askID: params.askId, phase: phase, text: params.text)
  }
}
