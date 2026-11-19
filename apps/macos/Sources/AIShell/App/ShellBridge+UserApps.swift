import AICore

/// `.userApp*` bridge call handlers extracted from ``ShellBridge`` (`05` §3.1).
extension ShellBridge {
  enum UserAppCall {
    case widgetPreview(UserAppWidgetPreviewParams)
    case open(UserAppOpenParams)
    case close(UserAppCloseParams)
    case clearData(UserAppClearDataParams)
    case pin(UserAppPinParams)
    case unpin(UserAppUnpinParams)
  }

  static func handleUserApp(
    _ call: UserAppCall,
    from host: WebViewHost,
    shell: ShellController
  ) async throws(BridgeError) -> JSONValue {
    switch call {
    case .widgetPreview(let params):
      return try encode(UserAppWidgetPreviewResult(pngBase64: try shell.widgets.preview(params)))
    case .open(let params):
      try await shell.openUserApp(params.appId)
      return try encode(NativeEmpty())
    case .close(let params):
      shell.userApps.close(appId: params.appId)
      return try encode(NativeEmpty())
    case .clearData(let params):
      if params.forget { shell.pins.forget(appId: params.appId) }
      try await shell.userApps.clearData(appId: params.appId, forget: params.forget)
      return try encode(NativeEmpty())
    case .pin(let params):
      try await shell.pinUserApp(params, from: host)
      return try encode(NativeEmpty())
    case .unpin(let params):
      shell.pins.unpin(appId: params.appId)
      return try encode(NativeEmpty())
    }
  }
}
