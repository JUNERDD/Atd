import Foundation

/// Where recordings are saved, and the folders the record bar's Save Location menu offers: the
/// three standard folders, always, then up to ``recentLimit`` folders chosen with "Other…", most
/// recent first. The current folder is always one of them. Folders are absolute, standardized
/// paths (no `~`, no trailing slash), so one folder is never listed twice.
public struct RecordingFolders: Equatable, Sendable {
  /// The folders every menu lists, in its order.
  public enum Standard: String, CaseIterable, Sendable {
    case movies
    case desktop
    case documents

    /// This user's folder.
    public var path: String {
      let url =
        switch self {
        case .movies: URL.moviesDirectory
        case .desktop: URL.desktopDirectory
        case .documents: URL.documentsDirectory
        }
      return RecordingFolders.standardized(url.path(percentEncoded: false))
    }

    /// The standard folder at `path`, if it is one.
    public init?(path: String) {
      let path = RecordingFolders.standardized(path)
      guard let match = Self.allCases.first(where: { $0.path == path }) else { return nil }
      self = match
    }
  }

  public static let recentLimit = 3

  /// The folder recordings are saved to.
  public private(set) var current: String
  /// Folders chosen with "Other…", most recent first: none standard, none twice, at most
  /// ``recentLimit``.
  public private(set) var recent: [String]

  /// Saves to Movies; no recent folders.
  public init() {
    current = Standard.movies.path
    recent = []
  }

  /// `current` among `recent`, cleaned up as the list requires; a current folder that is
  /// neither standard nor recent joins the recent ones first.
  public init(current: String, recent: [String]) {
    self.current = Self.standardized(current)
    self.recent = Self.listed(recent)
    if !offered.contains(self.current) { remember(self.current) }
  }

  /// Every folder the menu offers: the standard ones, then the recent ones.
  public var offered: [String] { Standard.allCases.map(\.path) + recent }

  public var currentURL: URL { URL(filePath: current, directoryHint: .isDirectory) }

  /// Saves to `path`, one of ``offered`` (picked in the menu); a folder not offered is ignored.
  public mutating func select(_ path: String) {
    let path = Self.standardized(path)
    guard offered.contains(path) else { return }
    current = path
  }

  /// Saves to `path`, chosen with "Other…": a folder that is not standard moves to the front
  /// of the recent ones, pushing the oldest out past the limit.
  public mutating func choose(_ path: String) {
    let path = Self.standardized(path)
    remember(path)
    current = path
  }

  /// Without the recent folders that no longer exist (`exists` answers for a path); saving to a
  /// folder that is gone goes back to Movies.
  public func pruned(keeping exists: (String) -> Bool) -> Self {
    var folders = self
    folders.recent = recent.filter(exists)
    if !folders.offered.contains(current) || !exists(current) {
      folders.current = Standard.movies.path
    }
    return folders
  }

  private mutating func remember(_ path: String) {
    guard Standard(path: path) == nil else { return }
    recent = Array(([path] + recent.filter { $0 != path }).prefix(Self.recentLimit))
  }

  /// `paths` standardized, without standard folders and repeats, at most the limit.
  private static func listed(_ paths: [String]) -> [String] {
    var seen = Set<String>()
    let standard = Set(Standard.allCases.map(\.path))
    return Array(
      paths.map(standardized).filter { !standard.contains($0) && seen.insert($0).inserted }
        .prefix(recentLimit))
  }

  /// One spelling per folder: `~` expanded, `.` and `..` resolved, no trailing slash.
  static func standardized(_ path: String) -> String {
    (path as NSString).standardizingPath
  }
}
