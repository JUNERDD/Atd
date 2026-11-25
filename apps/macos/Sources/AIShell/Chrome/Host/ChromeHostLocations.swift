import Darwin
import Foundation

/// A Chrome host file or socket the shell could not set up. The message is for logs only.
nonisolated struct ChromeHostError: Error, Equatable, CustomStringConvertible {
  let description: String
}

/// Where the shell and its native messaging host meet (D3): the owner-only folder
/// `~/Library/Application Support/<bundle id>/chrome`, holding the host's socket and the pairings
/// store. The host binary derives the same socket path itself (Sources/AtdChromeHostCLI,
/// `HostLocation`) from Foundation's Application Support folder and its app's
/// `AtdHostBundleIdentifier`; the two must keep this layout in step.
nonisolated enum ChromeHostLocations {
  /// The host binary's file name in `Contents/MacOS` (project.yml: the `atd-chrome-host` target).
  static let hostExecutableName = "atd-chrome-host"

  /// The folder, created owner-only (0700) when missing and set back to 0700 when it exists with
  /// other modes. Throws when it cannot be created, is not a real directory (a symbolic link
  /// included) or belongs to another user, since the socket's safety rests on this folder.
  static func directory(bundleId: String) throws(ChromeHostError) -> URL {
    guard !bundleId.isEmpty, !bundleId.contains("/"), bundleId != ".", bundleId != ".." else {
      throw ChromeHostError(description: "\(bundleId) is not a bundle id.")
    }
    let support =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? URL(filePath: NSHomeDirectory()).appending(path: "Library/Application Support")
    let parent = support.appending(path: bundleId, directoryHint: .isDirectory)
    let directory = parent.appending(path: "chrome", directoryHint: .isDirectory)
    let path = directory.path(percentEncoded: false)
    do {
      // The bundle id's folder is shared with the widget and pin files and keeps default modes;
      // only this folder is owner-only.
      try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    } catch {
      throw ChromeHostError(description: "\(path) could not be created.")
    }
    var status = stat()
    guard lstat(path, &status) == 0 else {
      throw ChromeHostError(
        description: "\(path) cannot be read: \(String(cString: strerror(errno))).")
    }
    guard status.st_mode & S_IFMT == S_IFDIR else {
      throw ChromeHostError(description: "\(path) is not a folder.")
    }
    guard status.st_uid == getuid() else {
      throw ChromeHostError(description: "\(path) belongs to another user.")
    }
    if status.st_mode & 0o7777 != 0o700, chmod(path, 0o700) != 0 {
      throw ChromeHostError(description: "\(path) could not be made owner-only.")
    }
    return directory
  }

  /// The socket the shell listens on and every host connects to.
  static func socket(bundleId: String) throws(ChromeHostError) -> URL {
    try directory(bundleId: bundleId).appending(path: "host.sock", directoryHint: .notDirectory)
  }

  /// The pairings store (D4), beside the socket.
  static func pairings(bundleId: String) throws(ChromeHostError) -> URL {
    try directory(bundleId: bundleId).appending(path: "pairings.json", directoryHint: .notDirectory)
  }

  /// The host binary this build embeds (`Contents/MacOS/atd-chrome-host`, or the file of that
  /// name beside a SwiftPM-built executable); nil when the build has none.
  static func hostExecutable(in bundle: Bundle = .main) -> URL? {
    bundle.url(forAuxiliaryExecutable: hostExecutableName)
  }
}
