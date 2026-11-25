import AIChromeChannelKit
import AICore
import Darwin
import Foundation
import os

/// The native messaging host manifest through which Chromium browsers find `atd-chrome-host` (D3):
/// one `NativeMessagingHosts/<host name>.json` in each discovered Chromium user-data folder,
/// admitting only this build's flavor of the extension. Installing is idempotent, rewrites a file
/// only when its content differs (the app moved, the flavor changed) and never touches another
/// host's manifest.
nonisolated enum ChromeHostManifest {
  typealias Status = ComputerStateEvent.Chrome.HostManifest

  struct Result: Equatable, Sendable {
    let status: Status
    let browsers: [String]
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome-host")

  /// Home folders a host binary must not run from: browsers would need the person's consent to
  /// read it there (privacy-protected folders).
  static let blockedHomeFolders = ["Documents", "Desktop", "Downloads"]

  /// Installs or refreshes the manifest in every discovered Chromium browser folder.
  /// `blockedLocation` when the app runs translocated (from a read-only, randomized copy) or from
  /// a blocked home folder; `failed` when the build embeds no host binary or a manifest cannot be
  /// written; `chromeMissing` when no active Chromium browser folder is discovered.
  static func install(
    identity: ChromeChannelIdentity, hostExecutable: URL?, bundleURL: URL,
    home: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> Result {
    let translocated = ShellEnvironmentProbes.inspectPlacement(
      bundleURL: bundleURL, homePath: home.path(percentEncoded: false),
      widgetsIndexedLocation: false, runningNodePid: nil, allowedExecutableRoot: nil
    ).record.isTranslocated
    let blocked = blockedHomeFolders.flatMap { paths(of: home.appending(path: $0)) }
    if translocated || isBlocked(bundlePaths: paths(of: bundleURL), blockedFolders: blocked) {
      return Result(status: .blockedLocation, browsers: [])
    }
    guard let hostExecutable,
      FileManager.default.isExecutableFile(atPath: hostExecutable.path(percentEncoded: false))
    else {
      log.error("No Chrome host binary in this build; the host manifest is not installed")
      return Result(status: .failed, browsers: [])
    }
    let targets = ChromeHostDiscovery.discover(extensionId: identity.extensionId, home: home)
    guard !targets.isEmpty else { return Result(status: .chromeMissing, browsers: []) }
    guard
      let contents = try? contents(
        identity: identity, hostPath: hostExecutable.path(percentEncoded: false))
    else { return Result(status: .failed, browsers: []) }
    var allSucceeded = true
    var succeeded = Set<String>()
    for target in targets {
      let file = target.directory
        .appending(path: "NativeMessagingHosts", directoryHint: .isDirectory)
        .appending(path: "\(identity.hostName).json")
      if write(contents, to: file) {
        let name = target.displayName.clipped(toUTF16: 120)
        if !name.isEmpty { succeeded.insert(name) }
      } else {
        allSucceeded = false
      }
    }
    return Result(
      status: allSucceeded ? .installed : .failed,
      browsers: Array(succeeded.sorted().prefix(32)))
  }

  /// The manifest's bytes: Chrome's five keys, sorted and pretty-printed so an unchanged manifest
  /// reads back byte for byte. `hostPath` must be absolute.
  static func contents(identity: ChromeChannelIdentity, hostPath: String) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(
      Manifest(
        name: identity.hostName, description: "Atd for Chrome", path: hostPath, type: "stdio",
        allowedOrigins: [identity.origin]))
  }

  /// Whether any of `bundlePaths` lies inside one of `blockedFolders`. Compared case-insensitively,
  /// as the default APFS volume resolves names.
  static func isBlocked(bundlePaths: [String], blockedFolders: [String]) -> Bool {
    let prefixes = blockedFolders.map { ($0.hasSuffix("/") ? $0 : $0 + "/").lowercased() }
    return bundlePaths.contains { path in
      let path = path.lowercased()
      return prefixes.contains { path.hasPrefix($0) }
    }
  }

  /// `url`'s path as given and with symbolic links resolved, so a link on either side of the
  /// comparison does not hide a blocked location.
  private static func paths(of url: URL) -> [String] {
    [
      url.standardizedFileURL.path(percentEncoded: false),
      url.resolvingSymlinksInPath().path(percentEncoded: false),
    ]
  }

  private static let maxManifestBytes = 64 * 1024

  /// Writes `contents` to `file` unless a regular non-symlink file already holds exactly that;
  /// refuses symlinks on both `NativeMessagingHosts` and `<hostName>.json` and never reads
  /// oversized or special files.
  private static func write(_ contents: Data, to file: URL) -> Bool {
    guard !contents.isEmpty, contents.count <= maxManifestBytes else { return false }
    let dirPath = normalizedPath(file.deletingLastPathComponent())
    let filePath = normalizedPath(file)
    guard ensureRealDirectory(atPath: dirPath) else {
      log.error(
        "Refused Chrome host manifest directory \(dirPath, privacy: .private): not a real folder")
      return false
    }

    var existingStat = stat()
    if lstat(filePath, &existingStat) == 0 {
      guard (existingStat.st_mode & S_IFMT) == S_IFREG else {
        log.error(
          "Refused Chrome host manifest \(filePath, privacy: .private): not a regular file")
        return false
      }
      if existingStat.st_size == off_t(contents.count),
        readRegularNoFollow(atPath: filePath, expectedCount: contents.count) == contents
      {
        return true
      }
    } else if errno != ENOENT {
      return false
    }

    let stagingPath = "\(filePath).tmp-\(UUID().uuidString)"
    let fd = Darwin.open(stagingPath, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644)
    guard fd >= 0 else {
      log.error(
        "The Chrome host manifest staging file could not be opened at \(filePath, privacy: .private)"
      )
      return false
    }
    let wroteAll = contents.withUnsafeBytes { raw -> Bool in
      guard let base = raw.baseAddress else { return true }
      var offset = 0
      while offset < raw.count {
        let count = Darwin.write(fd, base + offset, raw.count - offset)
        if count > 0 {
          offset += count
        } else if count < 0, errno == EINTR {
          continue
        } else {
          return false
        }
      }
      return true
    }
    _ = Darwin.close(fd)
    guard wroteAll,
      isRealDirectory(atPath: dirPath),
      isMissingOrRegularFile(atPath: filePath),
      Darwin.rename(stagingPath, filePath) == 0
    else {
      _ = Darwin.unlink(stagingPath)
      log.error("The Chrome host manifest could not be written to \(filePath, privacy: .private)")
      return false
    }
    return true
  }

  private static func normalizedPath(_ url: URL) -> String {
    var path = url.standardizedFileURL.path(percentEncoded: false)
    while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
    return path
  }

  private static func ensureRealDirectory(atPath path: String) -> Bool {
    var status = stat()
    if lstat(path, &status) == 0 {
      return (status.st_mode & S_IFMT) == S_IFDIR
    }
    guard errno == ENOENT, Darwin.mkdir(path, 0o755) == 0 || errno == EEXIST else { return false }
    return isRealDirectory(atPath: path)
  }

  private static func isRealDirectory(atPath path: String) -> Bool {
    var status = stat()
    return lstat(path, &status) == 0 && (status.st_mode & S_IFMT) == S_IFDIR
  }

  private static func isMissingOrRegularFile(atPath path: String) -> Bool {
    var status = stat()
    if lstat(path, &status) == 0 { return (status.st_mode & S_IFMT) == S_IFREG }
    return errno == ENOENT
  }

  private static func readRegularNoFollow(atPath path: String, expectedCount: Int) -> Data? {
    let fd = Darwin.open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    guard fd >= 0 else { return nil }
    defer { _ = Darwin.close(fd) }
    var status = stat()
    guard fstat(fd, &status) == 0,
      (status.st_mode & S_IFMT) == S_IFREG,
      status.st_size == off_t(expectedCount)
    else { return nil }
    var buffer = [UInt8](repeating: 0, count: expectedCount + 1)
    var total = 0
    while total < buffer.count {
      let n = buffer.withUnsafeMutableBytes {
        Darwin.read(fd, $0.baseAddress! + total, $0.count - total)
      }
      if n > 0 {
        total += n
      } else if n == 0 {
        break
      } else if errno == EINTR {
        continue
      } else {
        return nil
      }
    }
    return total == expectedCount ? Data(buffer.prefix(expectedCount)) : nil
  }

  private struct Manifest: Encodable {
    let name: String
    let description: String
    let path: String
    let type: String
    let allowedOrigins: [String]

    private enum CodingKeys: String, CodingKey {
      case name, description, path, type
      case allowedOrigins = "allowed_origins"
    }
  }
}
