import AtdModel
import Foundation

/// A mini app on the 小应用 tab: what identifies it and which version of its code is current.
/// The code itself is on disk per version (`MiniAppPackage`), and its data beside it.
public struct MiniApp: Codable, Sendable, Equatable, Hashable, Identifiable {
  public var id: String
  public var name: String
  /// An SF Symbol name, inked on the app's sticker.
  public var symbol: String
  public var tint: CommandTint
  /// 记账本, 喝水 and 露营清单: they cannot be deleted, as built-in commands cannot.
  public var builtin: Bool
  /// The current version (`v<N>`); 改一改 writes the next one and 撤销 goes back.
  public var version: Int
  /// What 改一改 suggests saying (可以这样说), at most three.
  public var ideas: [String]
  public var createdAt: Date
  public var updatedAt: Date

  public init(
    id: String, name: String, symbol: String, tint: CommandTint, builtin: Bool = false,
    version: Int = 1, ideas: [String] = [], createdAt: Date, updatedAt: Date? = nil
  ) {
    self.id = id
    self.name = name
    self.symbol = symbol
    self.tint = tint
    self.builtin = builtin
    self.version = version
    self.ideas = ideas
    self.createdAt = createdAt
    self.updatedAt = updatedAt ?? createdAt
  }
}

/// The mini apps (`mini-apps.json`), in the order the tab shows them, and the one opened or
/// created last: a newly added widget shows that one until the person picks another.
public struct MiniAppLibrary: SharedDocument {
  public static let fileName = "mini-apps.json"
  public static let schemaVersion = 1

  public var apps: [MiniApp]
  public var recentID: String?

  public init(apps: [MiniApp] = [], recentID: String? = nil) {
    self.apps = apps
    self.recentID = recentID
  }

  /// Empty: the store adds the built-in apps the first time it reads the library.
  public static func initial() -> MiniAppLibrary {
    MiniAppLibrary()
  }

  public func app(_ id: String) -> MiniApp? {
    apps.first { $0.id == id }
  }

  /// The app a new widget shows: the recent one, else the first.
  public var recent: MiniApp? {
    recentID.flatMap(app) ?? apps.first
  }

  mutating func upsert(_ app: MiniApp) {
    if let index = apps.firstIndex(where: { $0.id == app.id }) {
      apps[index] = app
    } else {
      apps.append(app)
    }
  }
}
