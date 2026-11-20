import AppIntents
import AtdInk
import AtdMiniApps
import AtdModel
import SwiftUI
import WidgetKit

/// A mini app's widget on the Home Screen and the Lock Screen, for the app chosen in its
/// configuration (`MiniAppWidgetIntent`, which lives in AtdMiniApps because the app declares it
/// too). It is drawn natively from the app's data through one of Atd's widget templates; the
/// page's code never runs here. A tap opens the app in Atd; counter buttons and checklist rows
/// change the data in place.
public struct MiniAppWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: MiniApps.widgetKind, intent: MiniAppWidgetIntent.self, provider: MiniAppTimeline()
    ) { entry in
      MiniAppWidgetView(entry: entry)
    }
    .configurationDisplayName(Text(Self.text("miniApp.name")))
    .description(Text(Self.text("miniApp.description")))
    .supportedFamilies([
      .systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }

  static func text(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "MiniApps", bundle: .module)
  }
}

/// One entry now and one at each of the next two midnights, when daily values, streaks and
/// month totals roll over; then WidgetKit asks again. Writes reload the timeline sooner: the
/// app after its page changes data, WidgetKit after a button's intent, `LedgerBook` after an
/// expense.
struct MiniAppTimeline: AppIntentTimelineProvider {
  struct Entry: TimelineEntry {
    let date: Date
    let glance: MiniAppGlance
    let url: URL?
  }

  func placeholder(in context: Context) -> Entry {
    Entry(date: .now, glance: MiniAppBuiltins.sampleGlance(), url: nil)
  }

  func snapshot(for configuration: MiniAppWidgetIntent, in context: Context) async -> Entry {
    if context.isPreview, configuration.app == nil {
      return Entry(date: .now, glance: MiniAppBuiltins.sampleGlance(), url: nil)
    }
    return entry(for: configuration, at: .now)
  }

  func timeline(for configuration: MiniAppWidgetIntent, in context: Context) async -> Timeline<
    Entry
  > {
    let calendar = Calendar.current
    let today = calendar.startOfDay(for: .now)
    let midnights = (1...2).compactMap { calendar.date(byAdding: .day, value: $0, to: today) }
    let entries =
      [entry(for: configuration, at: .now)]
      + midnights.map { entry(for: configuration, at: $0) }
    return Timeline(entries: entries, policy: .atEnd)
  }

  private func entry(for configuration: MiniAppWidgetIntent, at date: Date) -> Entry {
    guard let store = MiniAppStore.current else {
      return Entry(date: date, glance: .missing(nil), url: AtdRoute.miniApps.url())
    }
    let library = store.library()
    let app = configuration.app.map { library.app($0.id) } ?? library.recent
    guard let app else {
      // The chosen app was deleted after the widget was added.
      return Entry(
        date: date, glance: .missing(nil, name: configuration.app?.name),
        url: AtdRoute.miniApps.url())
    }
    let manifest = store.manifest(app)
    let glance = MiniAppGlance.make(
      app: app, manifest: manifest, data: manifest.map { store.data(app.id, schema: $0.schema) },
      ledger: manifest?.schema.ledger == true ? store.ledger() : nil, now: date)
    return Entry(date: date, glance: glance, url: AtdRoute.miniApp(id: app.id).url())
  }
}

struct MiniAppWidgetView: View {
  let entry: MiniAppTimeline.Entry
  @Environment(\.widgetFamily) private var family
  @Environment(\.widgetRenderingMode) private var renderingMode

  var body: some View {
    MiniAppGlanceView(glance: entry.glance, family: glanceFamily)
      .environment(\.miniAppGlanceStyle, renderingMode == .fullColor ? .fullColor : .monochrome)
      .widgetURL(entry.url)
      .containerBackground(for: .widget) {
        switch family {
        case .systemSmall, .systemMedium: InkColor.paper
        case .accessoryCircular: AccessoryWidgetBackground()
        default: Color.clear
        }
      }
  }

  private var glanceFamily: MiniAppGlanceFamily {
    switch family {
    case .systemMedium: .medium
    case .accessoryCircular: .circular
    case .accessoryRectangular: .rectangular
    case .accessoryInline: .inline
    default: .small
    }
  }
}
