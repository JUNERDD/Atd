import AICore
import Foundation

/// The user's Screenshot settings in the shell: what confirming a screenshot capture with
/// the toolbar ✓ button (or Return / double-click) does (attach to composer and copy, attach
/// only, or copy only), whether that preference also applies when confirming a screenshot started
/// from the composer's "+ › Screenshot" menu, whether confirming a live long screenshot opens the
/// result card, copies, or saves locally, and the local save folder (or `nil` for "Ask each time").
final class ScreenshotPreferences {
  static let shared = ScreenshotPreferences()

  private(set) var confirmAction: ScreenshotPreferencesSetPost.ConfirmAction
  private(set) var confirmInComposer: Bool
  private(set) var longScreenshotConfirmAction:
    ScreenshotPreferencesSetPost.LongScreenshotConfirmAction
  private(set) var folders: SaveLocationFolders

  private let defaults: UserDefaults

  private static let confirmActionKey = "screenshotPreferences.confirmAction"
  private static let confirmInComposerKey = "screenshotPreferences.confirmInComposer"
  private static let legacyCopyOnConfirmKey = "screenshotPreferences.copyOnConfirm"
  private static let longScreenshotConfirmActionKey =
    "screenshotPreferences.longScreenshotConfirmAction"
  private static let customSaveFolderKey = "screenshotPreferences.customSaveFolder"
  private static let recentSaveFoldersKey = "screenshotPreferences.recentSaveFolders"

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    if let storedAction = defaults.string(forKey: Self.confirmActionKey).flatMap(
      ScreenshotPreferencesSetPost.ConfirmAction.init(rawValue:))
    {
      confirmAction = storedAction
    } else if (defaults.object(forKey: Self.legacyCopyOnConfirmKey) as? Bool) == false {
      confirmAction = .attach
    } else {
      confirmAction = .attachAndCopy
    }
    confirmInComposer = defaults.object(forKey: Self.confirmInComposerKey) as? Bool ?? false
    longScreenshotConfirmAction =
      defaults.string(forKey: Self.longScreenshotConfirmActionKey).flatMap(
        ScreenshotPreferencesSetPost.LongScreenshotConfirmAction.init(rawValue:)) ?? .card
    let current = defaults.string(forKey: Self.customSaveFolderKey)
    let recent = defaults.stringArray(forKey: Self.recentSaveFoldersKey) ?? []
    folders = SaveLocationFolders(current: current, recent: recent).pruned(keeping: Self.isFolder)
  }

  /// Resolves what confirming a toolbar screenshot does for this entry point.
  func effectiveConfirmAction(fromComposer: Bool) -> ScreenshotPreferencesSetPost.ConfirmAction {
    fromComposer && !confirmInComposer ? .attach : confirmAction
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
    defaults.set(post.confirmAction.rawValue, forKey: Self.confirmActionKey)
    defaults.set(post.confirmInComposer, forKey: Self.confirmInComposerKey)
    defaults.removeObject(forKey: Self.legacyCopyOnConfirmKey)
    defaults.set(
      post.longScreenshotConfirmAction.rawValue, forKey: Self.longScreenshotConfirmActionKey)
    confirmAction = post.confirmAction
    confirmInComposer = post.confirmInComposer
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
