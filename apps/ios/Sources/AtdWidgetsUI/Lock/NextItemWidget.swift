import AtdActions
import AtdIntents
import AtdModel
import SwiftUI
import WidgetKit

/// 下一项 under the Lock Screen clock: the event on now or next (prototype `nextEvent`). It reads
/// the calendar only where Atd has full access, and never asks; without it, it offers 允许访问日历,
/// which opens Atd to ask.
public struct NextItemWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    StaticConfiguration(kind: EntryWidgetKind.nextItem, provider: NextItemProvider()) { entry in
      NextItemView(state: entry.state)
        .containerBackground(.clear, for: .widget)
    }
    .configurationDisplayName(Text(EntryCopy.string("next.name")))
    .supportedFamilies([.accessoryRectangular])
  }
}

/// What 下一项 shows at a moment.
enum NextItemState: Equatable, Sendable {
  /// The next item, or nil when nothing is coming in the days 下一项 looks at.
  case item(NextItem?)
  /// Atd may not read the calendar.
  case needsAccess
}

/// 下一项's timeline: an entry now and one each time what it shows changes by itself (an event
/// ends, a day begins). The app reloads it at launch and after access is granted; without access
/// it looks again within the hour, in case the person allowed it in Settings.
struct NextItemProvider: TimelineProvider {
  struct Entry: TimelineEntry, Sendable {
    let date: Date
    let state: NextItemState
  }

  private static let recheck: TimeInterval = 60 * 60

  func placeholder(in context: Context) -> Entry {
    Entry(date: .now, state: .item(nil))
  }

  func getSnapshot(in context: Context, completion: @escaping @Sendable (Entry) -> Void) {
    let fallback = placeholder(in: context)
    Task {
      let timeline = await Self.timeline(at: .now, reader: TodayReader())
      completion(timeline.entries.first ?? fallback)
    }
  }

  func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<Entry>) -> Void) {
    Task {
      completion(await Self.timeline(at: .now, reader: TodayReader()))
    }
  }

  static func timeline(at now: Date, reader: TodayReader, calendar: Calendar = .current) async
    -> Timeline<Entry>
  {
    guard let events = await reader.events(in: NextItem.interval(around: now, calendar: calendar))
    else {
      let entry = Entry(date: now, state: .needsAccess)
      return Timeline(entries: [entry], policy: .after(now.addingTimeInterval(recheck)))
    }
    let dates = [now] + NextItem.changes(of: events, after: now, calendar: calendar)
    let entries = dates.map { date in
      Entry(date: date, state: .item(NextItem.pick(events, at: date, calendar: calendar)))
    }
    return Timeline(entries: entries, policy: .atEnd)
  }
}
