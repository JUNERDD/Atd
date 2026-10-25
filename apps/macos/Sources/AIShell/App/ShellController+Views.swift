import AICore

/// The renderer's `view.open`: the windows of generative views (``ViewWindows``).
extension ShellController {
  /// The view windows. Their pages are renderer pages on the shell's bridge, made like the
  /// settings window's but given no replayed state: a view's page needs only the relay,
  /// `app.state` and its own window's state.
  static func makeViewWindows(services: ShellServices, bridge: ShellBridge) -> ViewWindows {
    ViewWindows { fragment in
      WebViewHost(role: .view, fragment: fragment, services: services, bridge: bridge)
    }
  }

  /// `view.open`. Not while a capture runs: the window would order in above its overlays.
  func openView(_ params: ViewOpenParams) throws(BridgeError) {
    guard !isCapturingScreenshot else { throw BridgeError("Finish the screenshot first.") }
    try viewWindows.open(params)
  }
}
