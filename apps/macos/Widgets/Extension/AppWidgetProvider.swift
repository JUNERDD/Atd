import AIWidgetModel
import AIWidgetRender
import AppIntents
import WidgetKit

/// What one timeline entry shows.
enum AppWidgetState: Sendable {
  /// A rendered tree of an app widget, drawn with the app's accent.
  case content(appId: String, view: WidgetNode, route: String?, accent: WidgetAccent?)
  /// The gallery's stand-in for an app widget that has no render yet: its app's name and accent
  /// and the widget's title.
  case branded(appName: String, title: String, accent: WidgetAccent?)
  /// Built-in example content for the gallery while no app declares a widget, which should show
  /// what the widget is for rather than an empty skeleton.
  case example
  /// No app widget chosen while the catalog lists some.
  case chooseApp
  /// No app declares a widget yet (or the shell has written nothing).
  case noApps
  /// The chosen app or widget was deleted.
  case gone
  /// The chosen widget lacks this family.
  case unsupportedSize
  /// No render of this widget has reached the shell yet; Atd may not be running.
  case waiting
  /// The snapshot file is unreadable or breaks the contract.
  case unreadable
}

struct AppWidgetEntry: TimelineEntry {
  let date: Date
  let state: AppWidgetState
}

/// Builds timelines from the files the shell writes (``WidgetFiles``). The extension never talks
/// to the service: it is sandboxed and reads only that directory. The shell reloads the widget's
/// timelines whenever it writes, so a shown render ends with `.never` unless later entries are
/// pending; message states recheck after half an hour in case the shell is not running.
struct AppWidgetProvider: AppIntentTimelineProvider {
  /// The gallery preview, also shown while a placed widget loads.
  func placeholder(in context: Context) -> AppWidgetEntry {
    AppWidgetEntry(date: .now, state: Self.gallery(family: context.family, now: .now))
  }

  func snapshot(for configuration: AppWidgetIntent, in context: Context) async -> AppWidgetEntry {
    let now = Date.now
    if context.isPreview {
      return AppWidgetEntry(date: now, state: Self.gallery(family: context.family, now: now))
    }
    return entries(for: configuration, family: context.family, now: now).first
      ?? AppWidgetEntry(date: now, state: .waiting)
  }

  func timeline(for configuration: AppWidgetIntent, in context: Context) async -> Timeline<
    AppWidgetEntry
  > {
    let now = Date.now
    let entries = entries(for: configuration, family: context.family, now: now)
    guard case .content = entries.first?.state else {
      return Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60)))
    }
    return Timeline(entries: entries, policy: entries.count > 1 ? .atEnd : .never)
  }

  /// The gallery entry's preview for `family` (``WidgetGalleryPreview``): the user's newest app
  /// widget of that family as it currently renders, else its stand-in, else the example.
  static func gallery(family: WidgetKit.WidgetFamily, now: Date) -> AppWidgetState {
    guard let files = WidgetFiles.forMainBundle(), let family = WidgetFamily(family) else {
      return .example
    }
    let catalog = try? files.readCatalog().get()
    switch WidgetGalleryPreview.choose(family: family, catalog: catalog, files: files, now: now) {
    case .render(let app, _, let entry):
      return .content(appId: app.appId, view: entry.view, route: entry.route, accent: app.accent)
    case .branded(let app, let widget):
      return .branded(appName: app.name, title: widget.title, accent: app.accent)
    case .example:
      return .example
    }
  }

  private func entries(
    for configuration: AppWidgetIntent, family: WidgetKit.WidgetFamily, now: Date
  )
    -> [AppWidgetEntry]
  {
    let message = { (state: AppWidgetState) in [AppWidgetEntry(date: now, state: state)] }
    guard let files = WidgetFiles.forMainBundle(), case .success(let catalog) = files.readCatalog()
    else { return message(.noApps) }
    guard let target = configuration.widget.flatMap({ WidgetSelection(id: $0.id) }) else {
      return message(catalog.apps.contains { !$0.widgets.isEmpty } ? .chooseApp : .noApps)
    }
    guard let app = catalog.apps.first(where: { $0.appId == target.appId }),
      let declared = app.widgets.first(where: { $0.id == target.widgetId })
    else { return message(.gone) }
    guard let family = WidgetFamily(family), declared.families.contains(family) else {
      return message(.unsupportedSize)
    }
    switch files.readSnapshot(appId: target.appId, widgetId: target.widgetId, family: family) {
    case .failure(.missing): return message(.waiting)
    case .failure(.invalid): return message(.unreadable)
    case .success(let snapshot):
      let planned = WidgetTimelinePlan.entries(of: snapshot.timeline, now: now)
      guard !planned.isEmpty else { return message(.unreadable) }
      return planned.map {
        AppWidgetEntry(
          date: $0.date,
          state: .content(
            appId: target.appId, view: $0.view, route: $0.route, accent: app.accent))
      }
    }
  }
}
