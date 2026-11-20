import AppIntents
import AtdModel
import Foundation

/// Which mini app a placed widget shows.
///
/// A configuration intent lives in a module both the app and the widget extension link: the app
/// declares every intent in its build, the extension's included, so both must have the same type
/// (Package.swift has the rule). Its copy is in `MainBundle/MiniAppIntents.xcstrings`, which
/// project.yml compiles into both bundles. With no app chosen, the widget shows the mini app
/// opened or created last (`MiniAppQuery.defaultResult()`), so saving an app and then adding the
/// widget needs no configuring.
public struct MiniAppWidgetIntent: WidgetConfigurationIntent {
  public static let title = LocalizedStringResource(
    "miniAppWidget.title", table: "MiniAppIntents")
  public static let description = IntentDescription(
    LocalizedStringResource("miniAppWidget.description", table: "MiniAppIntents"))

  @Parameter(title: LocalizedStringResource("miniAppWidget.app", table: "MiniAppIntents"))
  public var app: MiniAppEntity?

  public init() {}

  public init(app: MiniAppEntity?) {
    self.app = app
  }
}

/// A mini app as the widget's configuration and Shortcuts list it.
public struct MiniAppEntity: AppEntity {
  public static let typeDisplayRepresentation = TypeDisplayRepresentation(
    name: LocalizedStringResource("miniAppEntity.type", table: "MiniAppIntents"))
  public static let defaultQuery = MiniAppQuery()

  public var id: String
  public var name: String
  public var symbol: String

  public init(id: String, name: String, symbol: String) {
    self.id = id
    self.name = name
    self.symbol = symbol
  }

  public init(_ app: MiniApp) {
    self.init(id: app.id, name: app.name, symbol: app.symbol)
  }

  public var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", image: DisplayRepresentation.Image(systemName: symbol))
  }
}

/// The mini apps in the shared library, in the tab's order.
public struct MiniAppQuery: EntityQuery {
  public init() {}

  public func entities(for identifiers: [String]) async throws -> [MiniAppEntity] {
    let library = MiniAppStore.current?.library() ?? MiniAppLibrary()
    return identifiers.compactMap(library.app).map(MiniAppEntity.init)
  }

  public func suggestedEntities() async throws -> [MiniAppEntity] {
    (MiniAppStore.current?.library().apps ?? []).map(MiniAppEntity.init)
  }

  /// What a new widget shows: the mini app opened or created last.
  public func defaultResult() async -> MiniAppEntity? {
    MiniAppStore.current?.library().recent.map(MiniAppEntity.init)
  }
}

extension MiniAppStore {
  /// The store of the running bundle's App Group (the app's or the widget extension's), or nil
  /// where there is none (unit tests, previews).
  public static var current: MiniAppStore? {
    AppGroup.current().flatMap { MiniAppStore.appGroup($0) }
  }
}
