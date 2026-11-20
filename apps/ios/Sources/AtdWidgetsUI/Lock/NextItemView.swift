import AppIntents
import AtdIntents
import AtdModel
import SwiftUI
import WidgetKit

/// 下一项 as a rectangular accessory: its name, then the time and the title (15:00 产品周会), then
/// where. Without access the whole accessory is the button that opens Atd to ask.
struct NextItemView: View {
  let state: NextItemState

  var body: some View {
    switch state {
    case .item(let item):
      content(
        title: item.map(Self.title) ?? EntryCopy.string("next.none"),
        place: item.flatMap(Self.place)
      )
      .accessibilityElement(children: .combine)
    case .needsAccess:
      Button(intent: GrantAgendaAccessIntent()) {
        content(title: EntryCopy.string("access.allow"), place: nil)
      }
      .buttonStyle(.plain)
      .accessibilityElement(children: .combine)
    }
  }

  private func content(title: String, place: String?) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Label(EntryCopy.string("next.name"), systemImage: "calendar.badge.clock")
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.secondary)
      Text(title)
        .font(.system(size: 16, weight: .bold))
        .lineLimit(1)
      if let place {
        Text(place)
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .widgetAccentable()
  }

  /// When and what: the time today, 明天 and the time, or the weekday and the time; 全天 for an
  /// event without one.
  static func title(_ item: NextItem) -> String {
    let event = item.event
    let time =
      event.isAllDay
      ? EntryCopy.string("next.allDay") : event.start.formatted(date: .omitted, time: .shortened)
    let when =
      switch item.day {
      case .today: time
      case .tomorrow: EntryCopy.string("next.tomorrow \(time)")
      case .later: "\(event.start.formatted(.dateTime.weekday(.abbreviated))) \(time)"
      }
    return "\(when) \(event.title)"
  }

  /// Where the event is, when Calendar says.
  static func place(_ item: NextItem) -> String? {
    let place = item.event.location?.trimmingCharacters(in: .whitespacesAndNewlines)
    return place?.isEmpty == false ? place : nil
  }
}
