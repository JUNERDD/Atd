import AICore

/// The bridge's screenshot entry points: `screenshot.capture` and `screenshot.edit`, which run
/// ``ScreenshotTaker``'s session once nothing else needs the screen or the panel.
extension ShellController {
  /// `screenshot.capture`, which hides the panel while it runs. A summon still moving the panel
  /// would fight over it, and an open file dialog or confirmation would sit beneath the
  /// overlays, so the call is refused then.
  func captureScreenshot() async throws(BridgeError) -> ScreenshotCaptureResult {
    try checkScreenshotAllowed()
    return try await screenshots.capture()
  }

  /// `screenshot.edit`, under the same conditions as a capture.
  func editScreenshot(resourceId: String) async throws(BridgeError) -> ScreenshotEditResult {
    try checkScreenshotAllowed()
    return try await screenshots.edit(resourceId: resourceId)
  }

  private func checkScreenshotAllowed() throws(BridgeError) {
    guard !summoner.isSummoning else {
      throw BridgeError("The panel is still opening; try again.")
    }
    guard !systemPanels.isOpen, !confirmations.isShowing else {
      throw BridgeError("Close the open dialog before taking a screenshot.")
    }
  }

  /// A capture session covers every display; calls that would open a dialog wait for it.
  var isCapturingScreenshot: Bool { screenshots.isCapturing }
}
