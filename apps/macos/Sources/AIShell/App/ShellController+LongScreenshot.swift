import AICore

/// The long screenshot's wiring after its capture: the shell owns its orchestrator's lifetime and
/// gives the capture session only where a finished long screenshot goes.
extension ShellController {
  /// Creates the orchestrator once, before a capture that can offer the long screenshot runs.
  @discardableResult
  func installLongScreenshots() -> LongScreenshotController {
    if let installed = installedLongScreenshots { return installed }
    let controller = LongScreenshotController(
      island: commandProgress.longScreenshot, arbiter: deviceArbiter, attachments: attachments,
      panelHost: panelHost, systemPanels: systemPanels,
      showPanel: { [weak self] in self?.showPanel() })
    installedLongScreenshots = controller
    screenshots.longScreenshots = controller
    // The full-screen preview offers the screenshot's text commands and runs them through the
    // same runner as the capture editor.
    controller.screenshots = screenshots
    return controller
  }
}
