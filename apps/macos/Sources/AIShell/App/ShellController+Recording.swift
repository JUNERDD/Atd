import AICore

/// The screen recording's wiring: the shell owns its lifetime and gives the capture session
/// only the recording capability it needs.
extension ShellController {
  /// Creates the controller once, before a recording-capable capture or recording route runs.
  @discardableResult
  func installScreenRecording() -> ScreenRecordingController {
    if let installed = installedScreenRecording { return installed }
    let recording = ScreenRecordingController(
      island: commandProgress.recording, arbiter: deviceArbiter, attachments: attachments,
      panelHost: panelHost, screenAccess: screenRecording,
      showPanel: { [weak self] in self?.showPanel() })
    installedScreenRecording = recording
    screenshots.recorder = recording
    screenshots.makeRecordAccessory = { RecordOptionsBar() }
    return recording
  }
}
