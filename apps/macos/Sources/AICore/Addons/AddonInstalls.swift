import Darwin
import Foundation

/// The active add-on installs as `GET /v1/addons` reports them (`AddonListResponseSchema`), kept
/// only where the service may put them. The service owns `<dataDir>/addons`; the shell trusts a
/// reported path only when it is absolute and normalized, lies inside its install's `root`, and
/// that root lies inside the `addons` directory of the data directory the shell connected with,
/// all checked on the paths with every symbolic link resolved. An install with any path that
/// fails is treated as not installed.
public struct AddonInstalls: Equatable, Sendable {
  /// The validated entry points of each installed add-on, by add-on id, then entry name.
  public let entries: [String: [String: URL]]
  /// Why a reported install was refused, by add-on id; for the log only.
  public let refused: [String: String]

  public static let none = AddonInstalls(entries: [:], refused: [:])

  public init(entries: [String: [String: URL]], refused: [String: String]) {
    self.entries = entries
    self.refused = refused
  }

  /// The entry `name` of add-on `addon`, when it is installed and passed the checks.
  public func entry(_ addon: String, _ name: String) -> URL? {
    entries[addon]?[name]
  }

  /// Decodes a `GET /v1/addons` body. `dataDirectory` is the service data directory this shell
  /// connects with; installs outside its `addons` directory are refused.
  public static func decode(_ data: Data, dataDirectory: URL) throws -> AddonInstalls {
    let list = try JSONDecoder().decode(List.self, from: data)
    let addons = dataDirectory.appending(path: "addons", directoryHint: .isDirectory)
    var entries: [String: [String: URL]] = [:]
    var refused: [String: String] = [:]
    for view in list.addons {
      guard let installed = view.installed else { continue }
      switch validate(
        root: installed.root, entries: installed.entries,
        addonsDirectory: addons.path(percentEncoded: false))
      {
      case .success(let resolved): entries[view.id] = resolved
      case .failure(let problem): refused[view.id] = problem.message
      }
    }
    return AddonInstalls(entries: entries, refused: refused)
  }

  /// Why an install's paths were refused.
  public struct Problem: Error, Equatable, Sendable {
    public let message: String
  }

  /// Checks one install: `root` and each entry absolute and normalized, every entry lexically
  /// and physically inside `root`, and `root` physically inside `addonsDirectory`. Paths that do
  /// not exist fail, since they cannot be resolved.
  public static func validate(
    root: String, entries: [String: String], addonsDirectory: String
  ) -> Result<[String: URL], Problem> {
    guard isNormalizedAbsolute(root) else {
      return .failure(Problem(message: "The install root is not a normalized absolute path."))
    }
    guard let realAddons = realPath(addonsDirectory), let realRoot = realPath(root),
      isStrictlyInside(realRoot, realAddons)
    else {
      return .failure(Problem(message: "The install root is outside the add-ons directory."))
    }
    var resolved: [String: URL] = [:]
    for (name, path) in entries {
      guard isNormalizedAbsolute(path), isStrictlyInside(path, root),
        let realEntry = realPath(path), isStrictlyInside(realEntry, realRoot)
      else {
        return .failure(Problem(message: "The entry \(name) is outside its install root."))
      }
      resolved[name] = URL(filePath: realEntry, directoryHint: .notDirectory)
    }
    return .success(resolved)
  }

  /// Absolute, with no empty, `.` or `..` component and no trailing `/`.
  static func isNormalizedAbsolute(_ path: String) -> Bool {
    guard path.hasPrefix("/"), path.count > 1 else { return false }
    return path.dropFirst().split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
      !$0.isEmpty && $0 != "." && $0 != ".."
    }
  }

  static func isStrictlyInside(_ path: String, _ directory: String) -> Bool {
    path.hasPrefix(directory.hasSuffix("/") ? directory : directory + "/")
      && path.count > directory.count + 1
  }

  /// The path with every symbolic link resolved (`realpath(3)`); nil when it does not exist.
  static func realPath(_ path: String) -> String? {
    guard let resolved = realpath(path, nil) else { return nil }
    defer { free(resolved) }
    return String(cString: resolved)
  }

  /// The part of `AddonListResponseSchema` the shell reads.
  private struct List: Decodable {
    struct View: Decodable {
      struct Installed: Decodable {
        let root: String
        let entries: [String: String]
      }
      let id: String
      let installed: Installed?
    }
    let addons: [View]
  }
}
