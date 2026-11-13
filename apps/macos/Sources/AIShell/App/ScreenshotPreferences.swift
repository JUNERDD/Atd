import AICore
import Foundation

/// The user's Screenshot settings in the shell: whether confirming a screenshot capture with
/// the toolbar ✓ button (or Return / double-click) also copies it to the clipboard, whether
/// confirming a live long screenshot opens the result card, copies, or saves locally, and the
/// local save folder (or `nil` for "Ask each time").
final class ScreenshotPreferences {
  static let shared = ScreenshotPreferences()

  private(set) var copyOnConfirm: Bool
  private(set) var longScreenshotConfirmAction:
    ScreenshotPreferencesSetPost.LongScreenshotConfirmAction
  private(set) var folders: SaveLocationFolders

  private let defaults: UserDefaults

  private static let copyOnConfirmKey = "screenshotPreferences.copyOnConfirm"
  private static let longScreenshotConfirmActionKey =
    "screenshotPreferences.longScreenshotConfirmAction"
  private static let customSaveFolderKey = "screenshotPreferences.customSaveFolder"
  private static let recentSaveFoldersKey = "screenshotPreferences.recentSaveFolders"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    copyOnConfirm = defaults.object(forKey: Self.copyOnConfirmKey) as? Bool ?? true
    longScreenshotConfirmAction =
      defaults.string(forKey: Self.longScreenshotConfirmActionKey).flatMap(
        ScreenshotPreferencesSetPost.LongScreenshotConfirmAction.init(rawValue:)) ?? .card
    let current = defaults.string(forKey: Self.customSaveFolderKey)
    let recent = defaults.stringArray(forKey: Self.recentSaveFoldersKey) ?? []
    folders = SaveLocationFolders(current: current, recent: recent).pruned(keeping: Self.isFolder)
  }

  /// What confirming a live long screenshot does.
  var longScreenshotConfirm: CaptureSessionOptions.LongScreenshotConfirm {
    switch longScreenshotConfirmAction {
    case .card: .card
    case .copy: .copy
    case .save: .save
    }
  }

  func apply(_ post: ScreenshotPreferencesSetPost) {
    defaults.set(post.copyOnConfirm, forKey: Self.copyOnConfirmKey)
    defaults.set(
      post.longScreenshotConfirmAction.rawValue, forKey: Self.longScreenshotConfirmActionKey)
    copyOnConfirm = post.copyOnConfirm
    longScreenshotConfirmAction = post.longScreenshotConfirmAction
  }

  func prunedFolders() -> SaveLocationFolders {
    let pruned = folders.pruned(keeping: Self.isFolder)
    if pruned != folders { persistFolders(pruned) }
    return pruned
  }

  func currentSaveFolderURL() -> URL? {
    prunedFolders().currentURL
  }

  func selectSaveFolder(_ path: String?) {
    updateFolders { $0.select(path) }
  }

  func apply(chosenFolder url: URL) {
    updateFolders { $0.choose(url) }
  }

  func updateFolders(_ mutate: (inout SaveLocationFolders) -> Void) {
    var updated = prunedFolders()
    mutate(&updated)
    persistFolders(updated)
  }

  func saveState<Result, Folder>(
    makeResult: (String?, [Folder]) -> Result,
    makeFolder: (_ path: String, _ name: String, _ displayPath: String) -> Folder
  ) -> Result {
    let currentFolders = prunedFolders()
    let items = currentFolders.recent.map { path in
      let url = URL(filePath: path, directoryHint: .isDirectory)
      return makeFolder(
        path, SaveFolderDisplay.name(for: url), SaveLocationFolders.abbreviated(path))
    }
    return makeResult(currentFolders.current, items)
  }

  private func persistFolders(_ updated: SaveLocationFolders) {
    folders = updated
    if let current = updated.current {
      defaults.set(current, forKey: Self.customSaveFolderKey)
    } else {
      defaults.removeObject(forKey: Self.customSaveFolderKey)
    }
    defaults.set(updated.recent, forKey: Self.recentSaveFoldersKey)
  }

  private static func isFolder(_ path: String) -> Bool {
    var isDirectory = ObjCBool(false)
    return FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory)
      && isDirectory.boolValue
  }
}
