import SwiftUI
import WidgetKit

// Stub support (F0a): the placeholder timeline and views the first widget stubs share. Delete
// this file once no widget uses it.

/// One entry now and never another, for a widget that shows fixed content.
struct StubTimeline: TimelineProvider {
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

/// A Home Screen widget's placeholder: the feature's symbol and name in ink on the system's
/// frame.
struct StubWidgetView: View {
  let symbol: String
  let title: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Image(systemName: symbol)
        .font(.title2)
        .accessibilityHidden(true)
      Spacer(minLength: 0)
      Text(title)
        .font(.headline)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .containerBackground(.fill.tertiary, for: .widget)
  }
}

/// A Live Activity's placeholder on the Lock Screen.
struct StubActivityView: View {
  let symbol: String
  let title: String

  var body: some View {
    Label(title, systemImage: symbol)
      .font(.headline)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding()
  }
}

/// A Live Activity's placeholder in the Dynamic Island.
func stubIsland(symbol: String, title: String) -> DynamicIsland {
  DynamicIsland {
    DynamicIslandExpandedRegion(.center) {
      Label(title, systemImage: symbol)
    }
  } compactLeading: {
    Image(systemName: symbol)
  } compactTrailing: {
    EmptyView()
  } minimal: {
    Image(systemName: symbol)
  }
}
