import Foundation

/// Where the shell leaves widget content for the WidgetKit extension:
/// `~/Library/Application Support/<shell bundle id>/widgets/`. The extension is sandboxed and
/// reads this one directory through a read-only temporary-exception entitlement (T1b: works with
/// ad hoc and team signing, without a prompt; an App Group would need a profile). The shell is the
/// only writer. Debug and Release builds have different bundle ids, so their widgets never mix.
///
/// Layout:
/// - `catalog.json`: ``WidgetCatalogFile``, the apps and widgets the configuration lists;
/// - `snapshots/<appId>.<widgetId>.<family>.json`: one ``WidgetSnapshot`` each;
/// - `images/<appId>/<src>`: the image files snapshots reference, copied from the app version;
/// - `launcher.json`: ``WidgetLauncherFile``, the apps the "My Apps" launcher shows;
/// - `icons/<appId>.svg`: each launcher app's icon, copied as bytes from its current version.
public struct WidgetFiles: Sendable {
  public let directory: URL

  public init(directory: URL) {
    self.directory = directory
  }

  /// The directory of the shell `hostBundleId` names, under the user's real home: a sandboxed
  /// extension's `NSHomeDirectory()` is its container, so the account's home is used instead.
  public init(hostBundleId: String) {
    let home = URL(filePath: Self.accountHome(), directoryHint: .isDirectory)
    directory = home.appending(
      path: "Library/Application Support/\(hostBundleId)/widgets", directoryHint: .isDirectory)
  }

  /// Info.plist key both the shell and the extension carry: the shell's bundle id.
  public static let hostBundleIdKey = "AtdHostBundleIdentifier"

  /// The files of the shell this bundle belongs to, from its Info.plist; nil outside an app.
  public static func forMainBundle() -> WidgetFiles? {
    guard let id = Bundle.main.object(forInfoDictionaryKey: hostBundleIdKey) as? String,
      !id.isEmpty, !id.contains("/")
    else { return nil }
    return WidgetFiles(hostBundleId: id)
  }

  private static func accountHome() -> String {
    if let entry = getpwuid(getuid()), let dir = entry.pointee.pw_dir {
      return String(cString: dir)
    }
    return NSHomeDirectory()
  }

  public var catalogURL: URL { directory.appending(path: "catalog.json") }
  public var snapshotsURL: URL {
    directory.appending(path: "snapshots", directoryHint: .isDirectory)
  }
  public var imagesURL: URL { directory.appending(path: "images", directoryHint: .isDirectory) }

  /// A snapshot's file. The ids are checked by the contract's patterns (no `/` or `.` in an app
  /// id, none in a widget id), so the name cannot leave the directory.
  public func snapshotURL(appId: String, widgetId: String, family: WidgetFamily) -> URL {
    snapshotsURL.appending(path: "\(appId).\(widgetId).\(family.rawValue).json")
  }

  /// An image a snapshot references; `src` passed the contract's relative-path pattern, which
  /// admits no `..` segment.
  public func imageURL(appId: String, src: String) -> URL {
    imagesURL.appending(path: appId, directoryHint: .isDirectory).appending(path: src)
  }

  public var launcherURL: URL { directory.appending(path: "launcher.json") }
  public var iconsURL: URL { directory.appending(path: "icons", directoryHint: .isDirectory) }

  /// A launcher app's icon; the app id passed the contract's pattern, so the name cannot leave
  /// the directory.
  public func iconURL(appId: String) -> URL { iconsURL.appending(path: "\(appId).svg") }

  // MARK: Reading

  public enum ReadFailure: Error, Equatable, Sendable {
    /// No file: nothing was written yet, or the shell has not received this render.
    case missing
    /// A file that is too large or does not decode against the contract.
    case invalid
  }

  public func readCatalog() -> Result<WidgetCatalogFile, ReadFailure> {
    read(WidgetCatalogFile.self, from: catalogURL, limit: 16 * 1024 * 1024)
  }

  public func readSnapshot(appId: String, widgetId: String, family: WidgetFamily)
    -> Result<WidgetSnapshot, ReadFailure>
  {
    let url = snapshotURL(appId: appId, widgetId: widgetId, family: family)
    return read(WidgetSnapshot.self, from: url, limit: WidgetContract.snapshotMaxBytes)
      .flatMap {
        $0.timeline.entries.allSatisfy { $0.view.depth <= WidgetContract.maxDepth }
          ? .success($0) : .failure(.invalid)
      }
  }

  public func readLauncher() -> Result<WidgetLauncherFile, ReadFailure> {
    read(WidgetLauncherFile.self, from: launcherURL, limit: 64 * 1024)
  }

  /// The copied icon of a launcher app, nil when there is none or it fails
  /// ``WidgetLauncherIcon/accepts(_:)``. At most one byte past the limit is read.
  public func readIcon(appId: String) -> Data? {
    guard let handle = try? FileHandle(forReadingFrom: iconURL(appId: appId)) else { return nil }
    defer { try? handle.close() }
    let data = try? handle.read(upToCount: WidgetContract.launcherIconMaxBytes + 1)
    return data.flatMap { WidgetLauncherIcon.accepts($0) ? $0 : nil }
  }

  private func read<Value: Decodable>(_ type: Value.Type, from url: URL, limit: Int)
    -> Result<Value, ReadFailure>
  {
    guard let data = try? Data(contentsOf: url) else { return .failure(.missing) }
    guard data.count <= limit, let value = try? JSONDecoder().decode(type, from: data) else {
      return .failure(.invalid)
    }
    return .success(value)
  }
}

/// `catalog.json`: the service's catalog as of `writtenAt` (ISO 8601).
public struct WidgetCatalogFile: Codable, Equatable, Sendable {
  public let writtenAt: String
  public let apps: [WidgetCatalogApp]

  public init(writtenAt: String, apps: [WidgetCatalogApp]) {
    self.writtenAt = writtenAt
    self.apps = apps
  }
}

/// `launcher.json`: the service's launcher list (`WidgetSync.launcher`), the most recently updated
/// app first. The shell writes it after the icons, so a listed app finds its icon when it has one.
public struct WidgetLauncherFile: Codable, Equatable, Sendable {
  public let apps: [WidgetLauncherApp]

  public init(apps: [WidgetLauncherApp]) {
    self.apps = apps
  }
}
