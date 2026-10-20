import AICore
import Foundation

/// The browser profiles the host manages (D16): one directory per profile at
/// `<dataDir>/computer/profiles/<profileId>/`, inside the service's protected computer root,
/// created owner-only and used as Chrome's `--user-data-dir`. A profile starts empty: nothing is
/// copied from the person's own Chrome profile, and the default profile is never opened with a
/// DevTools endpoint. Profile ids are `Identifier`s, so an id can never reach outside the root.
final class ManagedBrowserProfiles {
  let root: URL

  init(dataDirectory: URL) {
    root = dataDirectory.appending(path: "computer/profiles", directoryHint: .isDirectory)
  }

  /// Creates an empty profile directory under a fresh id.
  func create(id: String = ManagedChromeLaunch.newProfileId()) throws -> (id: String, url: URL) {
    guard ManagedChromeLaunch.isProfileId(id) else {
      throw CocoaError(.fileWriteInvalidFileName)
    }
    let url = directory(id)
    let manager = FileManager.default
    try manager.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try manager.createDirectory(
      at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    return (id, url)
  }

  /// The directory of an existing profile, or nil when the id is malformed or the profile was
  /// never created on this data directory.
  func locate(_ id: String) -> URL? {
    guard ManagedChromeLaunch.isProfileId(id) else { return nil }
    let url = directory(id)
    var isDirectory: ObjCBool = false
    guard
      FileManager.default.fileExists(
        atPath: url.path(percentEncoded: false), isDirectory: &isDirectory),
      isDirectory.boolValue
    else { return nil }
    return url
  }

  /// Removes a profile whose preparation was abandoned, with whatever sign-in it holds.
  func remove(_ id: String) {
    guard let url = locate(id) else { return }
    try? FileManager.default.removeItem(at: url)
  }

  private func directory(_ id: String) -> URL {
    root.appending(path: id, directoryHint: .isDirectory)
  }
}
