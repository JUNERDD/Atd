import AICore
import AppKit

extension ShellBridge {
  enum ComputerBridgeCall {
    case listApplications
    case applicationIcon(ComputerApplicationIconParams)
    case previewShow(ComputerPreviewShowParams, document: Int)
    case prepareBrowser(ComputerPrepareBrowserParams)
    case openProfile(ComputerOpenProfileParams)
    case authorizeAutomation(ComputerAuthorizeAutomationParams)
    case acknowledgeUnsettled(ComputerAcknowledgeUnsettledParams)
    case setTyping(ComputerSetTypingParams)
    case setPointerVisible(ComputerSetPointerVisibleParams)
    case prepareApplication(ComputerPrepareApplicationParams)
    case primeCaptureConsent
  }

  static func handleComputer(
    _ call: ComputerBridgeCall, from host: WebViewHost, shell: ShellController
  ) async throws(BridgeError) -> JSONValue {
    switch call {
    case .listApplications:
      return try encode(await InstalledApplications.list())
    case .applicationIcon(let params):
      return try encode(
        ComputerApplicationIconResult(
          pngBase64: InstalledApplicationIcon.png(bundleId: params.bundleId)?.base64EncodedString())
      )
    case .previewShow(let params, let document):
      return try encode(shell.showComputerPreview(params, from: host, document: document))
    case .prepareBrowser(let params):
      return try encode(await shell.prepareComputerBrowser(params))
    case .openProfile(let params):
      try await shell.openComputerProfile(bindingId: params.bindingId)
      return try encode(NativeEmpty())
    case .authorizeAutomation(let params):
      return try encode(await shell.authorizeComputerAutomation(params))
    case .acknowledgeUnsettled(let params):
      shell.acknowledgeComputerUnsettled(params)
      return try encode(NativeEmpty())
    case .setTyping(let params):
      shell.computer.typing.set(params)
      shell.computer.onStateChange?()
      return try encode(NativeEmpty())
    case .setPointerVisible(let params):
      shell.computer.setPointerVisible(params.visible)
      return try encode(NativeEmpty())
    case .prepareApplication(let params):
      return try encode(await shell.prepareComputerApplication(params))
    case .primeCaptureConsent:
      return try encode(await shell.primeComputerCaptureConsent())
    }
  }
}
