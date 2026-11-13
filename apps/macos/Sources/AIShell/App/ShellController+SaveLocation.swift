import AICore
import Foundation

/// Bridge handlers for unified Screenshot and Recording save location settings.
extension ShellController {
  private enum SaveLocationTarget {
    case screenshot, recording
  }

  /// Current save location and recent custom folders (`saveLocation.state`).
  func saveLocationState(_ params: SaveLocationStateParams) -> SaveLocationStateResult {
    saveLocationResult(
      for: target(params.kind),
      makeResult: SaveLocationStateResult.init,
      makeFolder: SaveLocationStateResult.Folder.init)
  }

  /// Selects Ask each time (`nil`) or a remembered folder (`saveLocation.set`).
  func setSaveLocation(_ params: SaveLocationSetParams) -> SaveLocationSetResult {
    let kind = target(params.kind)
    updateSaveLocation(for: kind) { $0.select(params.path) }
    return saveLocationResult(
      for: kind,
      makeResult: SaveLocationSetResult.init,
      makeFolder: SaveLocationSetResult.Folder.init)
  }

  /// Opens the folder picker and adds any chosen folder (`saveLocation.pick`).
  func pickSaveLocation(_ params: SaveLocationPickParams) async -> SaveLocationPickResult {
    let kind = target(params.kind)
    let startingAt = currentSaveFolderURL(for: kind)
    let message = pickerMessage(for: kind)
    if let url = await systemPanels.chooseSaveFolder(startingAt: startingAt, message: message) {
      updateSaveLocation(for: kind) { $0.choose(url) }
    }
    return saveLocationResult(
      for: kind,
      makeResult: SaveLocationPickResult.init,
      makeFolder: SaveLocationPickResult.Folder.init)
  }

  private var recordingSaveDefaults: UserDefaults {
    installedScreenRecording?.defaults ?? .standard
  }

  private func target(_ kind: SaveLocationStateParams.Kind) -> SaveLocationTarget {
    switch kind {
    case .screenshot: .screenshot
    case .recording: .recording
    }
  }

  private func target(_ kind: SaveLocationSetParams.Kind) -> SaveLocationTarget {
    switch kind {
    case .screenshot: .screenshot
    case .recording: .recording
    }
  }

  private func target(_ kind: SaveLocationPickParams.Kind) -> SaveLocationTarget {
    switch kind {
    case .screenshot: .screenshot
    case .recording: .recording
    }
  }

  private func pickerMessage(for kind: SaveLocationTarget) -> String {
    switch kind {
    case .screenshot: ShellStrings.shared.text(ScreenshotSaveStringKey.folderPickerMessage)
    case .recording: ShellStrings.shared.text(RecordingOptionsStringKey.folderMessage)
    }
  }

  private func currentSaveFolderURL(for kind: SaveLocationTarget) -> URL? {
    switch kind {
    case .screenshot: ScreenshotPreferences.shared.currentSaveFolderURL()
    case .recording: RecordingSettingsMemory.load(from: recordingSaveDefaults).folders.currentURL
    }
  }

  private func updateSaveLocation(
    for kind: SaveLocationTarget, mutate: (inout SaveLocationFolders) -> Void
  ) {
    switch kind {
    case .screenshot:
      ScreenshotPreferences.shared.updateFolders(mutate)
      installedLongScreenshots?.refreshSaveFolder()
    case .recording:
      var settings = RecordingSettingsMemory.load(from: recordingSaveDefaults)
      mutate(&settings.folders)
      RecordingSettingsMemory.save(settings, to: recordingSaveDefaults)
      installedScreenRecording?.refreshSaveFolder()
    }
  }

  private func saveLocationResult<Result, Folder>(
    for kind: SaveLocationTarget,
    makeResult: (String?, [Folder]) -> Result,
    makeFolder: (_ path: String, _ name: String, _ displayPath: String) -> Folder
  ) -> Result {
    let folders: SaveLocationFolders =
      switch kind {
      case .screenshot: ScreenshotPreferences.shared.prunedFolders()
      case .recording: RecordingSettingsMemory.load(from: recordingSaveDefaults).folders
      }
    let items = folders.recent.map { path in
      let url = URL(filePath: path, directoryHint: .isDirectory)
      return makeFolder(
        path, SaveFolderDisplay.name(for: url), SaveLocationFolders.abbreviated(path))
    }
    return makeResult(folders.current, items)
  }
}
