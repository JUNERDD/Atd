import AIWidgetModel
import AppIntents

// The widget's configuration: which app widget an instance shows, asked for as soon as the
// widget is added and offered again in its Edit sheet. It is compiled into the WidgetKit
// extension only: the system resolves a configuration intent through the App Intents metadata of
// the bundle that declares it and instantiates the type by its mangled name, so a second copy in
// the host app (module `Atd`) makes the extension fail with `intentNotFound` and every timeline
// come back empty (runtime acceptance, v10). Copy comes from the extension's `Localizable` String
// Catalog, the table App Intents reads.

/// One widget a user app declares, listed as `<app name>` with the widget's title.
struct AppWidgetEntity: AppEntity, Sendable {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(
    name: LocalizedStringResource("widget.entity.type"))
  static let defaultQuery = AppWidgetQuery()

  /// `<appId>/<widgetId>`.
  let id: String
  let appName: String
  let title: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(appName)", subtitle: "\(title)")
  }
}

/// Lists the catalog the shell last wrote, the most recently updated app first. WidgetKit gives a
/// query no widget family, so every widget is listed; the timeline shows a readable state when
/// the chosen one lacks the size.
struct AppWidgetQuery: EntityQuery {
  func entities(for identifiers: [AppWidgetEntity.ID]) async throws -> [AppWidgetEntity] {
    Self.all().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [AppWidgetEntity] { Self.all() }

  /// The picker that opens when the widget is added starts at the newest app widget.
  func defaultResult() async -> AppWidgetEntity? { Self.all().first }

  static func all() -> [AppWidgetEntity] {
    guard case .success(let catalog) = WidgetFiles.forMainBundle()?.readCatalog() else {
      return []
    }
    return catalog.apps.flatMap { app in
      app.widgets.map { widget in
        AppWidgetEntity(id: "\(app.appId)/\(widget.id)", appName: app.name, title: widget.title)
      }
    }
  }
}

struct AppWidgetIntent: WidgetConfigurationIntent {
  static let title = LocalizedStringResource("widget.intent.title")
  static let description = IntentDescription(
    LocalizedStringResource("widget.intent.description"))

  @Parameter(title: LocalizedStringResource("widget.intent.parameter"))
  var widget: AppWidgetEntity?

  init() {}
}
