import Foundation

/// Where screenshots or recordings are saved locally, and up to ``recentLimit`` folders recently
/// chosen in Settings. `current == nil` means "Ask each time" (the default). Paths are absolute,
/// standardized (no `~`, no trailing slash), and deduplicated; any directory chosen with
/// ``choose(_:)`` is remembered, including standard system directories.
public struct SaveLocationFolders: Codable, Equatable, Sendable {
  public static let recentLimit = 3

  /// The active save folder path, or `nil` for "Ask each time".
  public private(set) var current: String?
  /// Recently chosen folders, most recent first, deduplicated, up to ``recentLimit``.
  public private(set) var recent: [String]

  /// Defaults to "Ask each time" (`current = nil`) with no recent folders.
  public init() {
    current = nil
    recent = []
  }

  /// Restores `current` and `recent`, standardizing paths and inserting a non-nil `current` into
  /// `recent` if missing.
  public init(current: String?, recent: [String] = []) {
    self.recent = Self.listed(recent)
    if let current {
      let path = Self.standardized(current)
      if path.isEmpty {
        self.current = nil
      } else {
        self.current = path
        if !self.recent.contains(path) { remember(path) }
      }
    } else {
      self.current = nil
    }
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let current = try container.decodeIfPresent(String.self, forKey: .current)
    let recent = try container.decodeIfPresent([String].self, forKey: .recent) ?? []
    self.init(current: current, recent: recent)
  }

  private enum CodingKeys: String, CodingKey {
    case current, recent
  }

  public var currentURL: URL? {
    current.map { URL(filePath: $0, directoryHint: .isDirectory) }
  }

  /// Selects "Ask each time" (`nil`) keeping `recent`, or a path already in `recent`.
  public mutating func select(_ path: String?) {
    guard let path else {
      current = nil
      return
    }
    let standardized = Self.standardized(path)
    guard recent.contains(standardized) else { return }
    current = standardized
  }

  /// Sets `url` as the current folder after choosing it from the system panel, moving it to the
  /// front of ``recent`` (capped at ``recentLimit``).
  public mutating func choose(_ url: URL) {
    let path = Self.standardized(url.path(percentEncoded: false))
    guard !path.isEmpty else { return }
    remember(path)
    current = path
  }

  /// Drops recent folders for which `exists` returns false, and falls back to "Ask each time"
  /// (`nil`) if ``current`` is missing from `recent` or no longer exists.
  public func pruned(keeping exists: (String) -> Bool) -> SaveLocationFolders {
    var folders = self
    folders.recent = recent.filter(exists)
    if let current = folders.current, !folders.recent.contains(current) || !exists(current) {
      folders.current = nil
    }
    return folders
  }

  public static func abbreviated(_ path: String) -> String {
    (standardized(path) as NSString).abbreviatingWithTildeInPath
  }

  private mutating func remember(_ path: String) {
    recent = Array(([path] + recent.filter { $0 != path }).prefix(Self.recentLimit))
  }

  private static func listed(_ paths: [String]) -> [String] {
    var seen = Set<String>()
    return Array(
      paths.map(standardized).filter { !$0.isEmpty && seen.insert($0).inserted }.prefix(recentLimit)
    )
  }

  static func standardized(_ path: String) -> String {
    (path as NSString).standardizingPath
  }
}
