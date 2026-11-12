import AICore

/// The bridge's route for commands on text in a screenshot: `captureText.progress`, which the
/// panel's page sends as it runs one (`captureText.run`), routed to the surface that owns the run
/// (``CaptureTextRunner``).
extension ShellBridge {
  /// `captureText.progress`: only the panel's page runs these commands.
  static func progressCaptureText(
    _ params: CaptureTextProgressParams, from host: WebViewHost, shell: ShellController
  ) throws(BridgeError) {
    guard host === shell.panelHost else {
      throw BridgeError("Only the task panel can report a screenshot text command's progress.")
    }
    shell.screenshots.textRuns?.receive(params)
  }
}
