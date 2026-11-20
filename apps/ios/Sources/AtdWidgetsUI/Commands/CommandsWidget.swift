import AtdInk
import AtdModel
import SwiftUI
import WidgetKit

/// 常用指令 on the Home Screen: 拍了就办, 随手问, 记一笔 and 今日简报, each a single step
/// (prototype `home.js`). The buttons never change, so the timeline is one entry that never
/// reloads.
public struct CommandsWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    StaticConfiguration(kind: "commands", provider: CommandsTimeline()) { _ in
      CommandsWidgetFace()
    }
    .configurationDisplayName(Text(EntryCopy.string("commands.name")))
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

/// Reads the size the system gives the widget, which a view cannot set for itself.
private struct CommandsWidgetFace: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    CommandsWidgetView(family: family)
      .containerBackground(InkColor.paper, for: .widget)
      .widgetURL(AtdRoute.commands.url())
  }
}

/// One entry now and never another.
struct CommandsTimeline: TimelineProvider {
  struct Entry: TimelineEntry {
    let date: Date
  }

  func placeholder(in context: Context) -> Entry {
    Entry(date: .now)
  }

  func getSnapshot(in context: Context, completion: @escaping @Sendable (Entry) -> Void) {
    completion(Entry(date: .now))
  }

  func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<Entry>) -> Void) {
    completion(Timeline(entries: [Entry(date: .now)], policy: .never))
  }
}
