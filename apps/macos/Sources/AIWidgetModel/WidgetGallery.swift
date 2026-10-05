import Foundation

/// What the configurable widget shows in the widget gallery and as its placeholder, for one
/// family. macOS keeps a widget's gallery entry (its kind, name and families) as it first read it,
/// but asks the extension for the preview, so the preview is where the user's own apps show: the
/// newest real render of the family, else a stand-in made from the newest app's name and accent,
/// and the built-in example only while no app declares a widget. The catalog lists the most
/// recently updated app first (`WidgetSync.catalog`).
public enum WidgetGalleryPreview: Equatable, Sendable {
  /// A declared widget's render: the entry due now, drawn with its app's images and accent.
  case render(app: WidgetCatalogApp, widgetId: String, entry: WidgetPlannedEntry)
  /// No render of this family yet: the newest app widget's names and its app's accent.
  case branded(app: WidgetCatalogApp, widget: WidgetDecl)
  /// No app declares a widget (or the shell has written nothing).
  case example

  /// Snapshot files read per preview at most; the service keeps the newest widget of every
  /// family rendered (`WidgetPublisher`), so the first candidate normally has one.
  public static let maxCandidates = 32

  public static func choose(
    family: WidgetFamily, catalog: WidgetCatalogFile?, files: WidgetFiles, now: Date
  ) -> WidgetGalleryPreview {
    let apps = (catalog?.apps ?? []).filter { !$0.widgets.isEmpty }
    let candidates = apps.flatMap { app in
      app.widgets.filter { $0.families.contains(family) }.map { (app: app, widget: $0) }
    }
    for candidate in candidates.prefix(maxCandidates) {
      guard
        case .success(let snapshot) = files.readSnapshot(
          appId: candidate.app.appId, widgetId: candidate.widget.id, family: family),
        let entry = WidgetTimelinePlan.entries(of: snapshot.timeline, now: now).first
      else { continue }
      return .render(app: candidate.app, widgetId: candidate.widget.id, entry: entry)
    }
    if let newest = candidates.first { return .branded(app: newest.app, widget: newest.widget) }
    guard let app = apps.first, let widget = app.widgets.first else { return .example }
    return .branded(app: app, widget: widget)
  }
}
