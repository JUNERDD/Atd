import AICore
import AIRelay

extension ShellController {
  func computerConnectionChanged(_ state: ControlStreamClient.ConnectionState) {
    systemActivityConnectionChanged(state)
    computer.previewConnected = state == .connected
    if state != .connected { computer.previews.removeAll() }
  }

  func showComputerPreview(
    _ params: ComputerPreviewShowParams, from host: WebViewHost, document: Int
  ) -> ComputerPreviewShowResult {
    guard host === panelHost, panel.isVisible, host.document == document,
      shownComputerTaskId == params.taskId
    else { return .init(shown: false) }
    return .init(shown: computer.previews.show(taskId: params.taskId))
  }
}
