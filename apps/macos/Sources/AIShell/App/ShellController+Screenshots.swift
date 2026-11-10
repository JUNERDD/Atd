import AICore

/// The bridge's screenshot entry points: `screenshot.capture` and `screenshot.edit`, which run
/// ``ScreenshotTaker``'s session once nothing else needs the screen or the panel.
extension ShellController {
  /// Screenshot commands and their options stay available independently of recording setup.
  func wireScreenshots() {
    screenshots.commandOptions = { [weak self] in self?.commandOptions ?? CommandOptionsCatalog() }
    screenshots.copyShortcut = { [weak self] in
      self?.registrar?.displayLabel(for: SummonTrigger.screenshotID)
    }
    screenshots.onCommandOptionsPicked = { [weak self] id, values in
      self?.panelHost.send(
        .commandOptionsPicked(.init(id: id, arguments: values)), scope: .document)
    }
    screenshots.openCommandSettings = { [weak self] in
      self?.openSettings(commandId: nil, section: "commands")
    }
  }

  /// `screenshot.capture`, which hides the panel while it runs. A summon still moving the panel
  /// would fight over it, and an open file dialog or confirmation would sit beneath the
  /// overlays, so the call is refused then.
  func captureScreenshotInput() async throws(BridgeError) -> ScreenshotCaptureResult {
    try checkScreenshotAllowed()
    return try await screenshots.captureImage()
  }

  /// `screenshot.capture` with its params (architecture B2): the screenshot shortcut's and the
  /// mini panel's capture with the command row, or one that opens in record mode. The field in
  /// front is recorded in the summoner's write targets, where `text.write` finds it.
  func captureScreenshot(_ request: ScreenshotRequest) async throws(BridgeError)
    -> ScreenshotOutcome
  {
    try checkScreenshotAllowed()
    if request.toolbar {
      installScreenRecording()
      installLongScreenshots()
    }
    return try await screenshots.capture(request, writeTargets: summoner.writeTargets)
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
