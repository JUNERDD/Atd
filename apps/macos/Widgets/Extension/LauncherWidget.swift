import AIWidgetModel
import AIWidgetRender
import SwiftUI
import WidgetKit

/// "My Apps": a launcher of the user's apps, each tile opening its app. The kind and its sizes
/// never change, so the gallery entry macOS keeps from the first read stays right; only the
/// content follows the apps, and it needs no service render, just the shell's files.
struct LauncherWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetKinds.launcher, provider: LauncherProvider()) { entry in
      LauncherWidgetView(entry: entry)
    }
    .configurationDisplayName(LocalizedStringResource("launcher.displayName"))
    .description(LocalizedStringResource("launcher.description"))
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct LauncherEntry: TimelineEntry {
  let date: Date
  /// The apps to show, or nil while there are none.
  let tiles: [WidgetLauncherTile]?
}

/// Builds the launcher from the files the shell writes (``LauncherContent``). The shell reloads
/// this kind whenever it changes the launcher's files, so an entry lasts until then; while the
/// files are missing or unreadable (Atd has not synced yet) the widget looks again in half an
/// hour.
struct LauncherProvider: TimelineProvider {
  /// The gallery preview, also shown while a placed widget loads.
  func placeholder(in context: Context) -> LauncherEntry {
    LauncherEntry(date: .now, tiles: LauncherContent.gallery(family: context.family))
  }

  func getSnapshot(in context: Context, completion: @escaping @Sendable (LauncherEntry) -> Void) {
    let tiles =
      context.isPreview
      ? LauncherContent.gallery(family: context.family)
      : LauncherContent.current(family: context.family).tiles
    completion(LauncherEntry(date: .now, tiles: tiles))
  }

  func getTimeline(
    in context: Context, completion: @escaping @Sendable (Timeline<LauncherEntry>) -> Void
  ) {
    let now = Date.now
    let current = LauncherContent.current(family: context.family)
    let policy: TimelineReloadPolicy =
      current.read ? .never : .after(now.addingTimeInterval(30 * 60))
    completion(Timeline(entries: [LauncherEntry(date: now, tiles: current.tiles)], policy: policy))
  }
}

/// The grid of apps, or the empty state. A click outside the tiles, and any click while there are
/// no apps, shows Atd's task panel, where apps are made.
struct LauncherWidgetView: View {
  let entry: LauncherEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    content
      .containerBackground(.fill.tertiary, for: .widget)
      .widgetURL(WidgetLink.mainBundleScheme.flatMap(WidgetLink.panelURL(scheme:)))
  }

  @ViewBuilder
  private var content: some View {
    if let tiles = entry.tiles {
      WidgetLauncherView(tiles: tiles, layout: LauncherContent.layout(family))
    } else {
      WidgetMessageView(
        symbol: "square.grid.2x2", title: String(localized: "launcher.empty.title"),
        message: String(localized: "launcher.empty.message"))
    }
  }
}
