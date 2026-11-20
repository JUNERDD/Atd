import Foundation

/// The App Group the app and its keyboard extension share, read from the running bundle's
/// Info.plist (`AtdAppGroup`, set per build configuration in project.yml).
///
/// The keyboard reaches the group only with Full Access; without it the system keeps the
/// extension out of the shared container and `directory` is nil there.
public struct AppGroup: Sendable, Equatable {
  /// `group.com.junerdd.atd`, or `group.com.junerdd.atd.dev` in Debug builds.
  public let identifier: String

  public init(identifier: String) {
    self.identifier = identifier
  }

  /// The group of the bundle running this code, or nil when its Info.plist names none (unit
  /// tests, previews).
  public static func current(bundle: Bundle = .main) -> AppGroup? {
    guard let identifier = bundle.object(forInfoDictionaryKey: "AtdAppGroup") as? String,
      !identifier.isEmpty, !identifier.hasPrefix("$(")
    else { return nil }
    return AppGroup(identifier: identifier)
  }

  /// The Darwin notification posted after either process rewrites a shared file, so the other
  /// one reloads. Debug and Release builds use different names, like their groups.
  public var changeNotificationName: String {
    "\(baseIdentifier).library.changed"
  }

  /// Where the shared files live: `Library/Application Support/Atd` in the group container.
  public func directory(fileManager: FileManager = .default) -> URL? {
    fileManager.containerURL(forSecurityApplicationGroupIdentifier: identifier)?
      .appending(path: "Library/Application Support/Atd", directoryHint: .isDirectory)
  }

  /// `com.junerdd.atd` for `group.com.junerdd.atd`.
  var baseIdentifier: String {
    identifier.hasPrefix("group.") ? String(identifier.dropFirst("group.".count)) : identifier
  }
}
