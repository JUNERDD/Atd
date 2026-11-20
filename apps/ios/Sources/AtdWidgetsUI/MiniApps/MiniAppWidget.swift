import AppIntents
import AtdMiniApps
import AtdModel
import SwiftUI
import WidgetKit

/// A mini app's widget on the Home Screen, for the mini app chosen when it was added.
///
/// Stub (F0a): shows the chosen name and opens the 小应用 tab; its configuration intent
/// (`MiniAppWidgetIntent`) lives in AtdMiniApps. WS-D replaces it with the mini app's native
/// widget templates.
public struct MiniAppWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "miniApp", intent: MiniAppWidgetIntent.self, provider: MiniAppTimeline()
    ) { entry in
      StubWidgetView(symbol: "square.on.circle", title: entry.app ?? Self.name)
        .widgetURL(AtdRoute.miniApps.url())
    }
    .configurationDisplayName(Text(Self.name))
    .supportedFamilies([.systemSmall])
  }

  private static var name: String {
    String(localized: "miniApp.name", table: "MiniApps", bundle: .module)
  }
}

struct MiniAppTimeline: AppIntentTimelineProvider {
  struct Entry: TimelineEntry {
    let date: Date
    let app: String?
  }

  func placeholder(in context: Context) -> Entry {
    Entry(date: .now, app: nil)
  }

  func snapshot(for configuration: MiniAppWidgetIntent, in context: Context) async -> Entry {
    Entry(date: .now, app: configuration.app)
  }

  func timeline(for configuration: MiniAppWidgetIntent, in context: Context) async -> Timeline<
    Entry
  > {
    Timeline(entries: [Entry(date: .now, app: configuration.app)], policy: .never)
  }
}
