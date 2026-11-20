import ActivityKit
import AtdIntents
import SwiftUI
import WidgetKit

/// 今日简报's Live Activity on the Lock Screen and in the Dynamic Island.
///
/// Stub (F0a): WS-A replaces it with the briefing's progress and its three sentences.
public struct BriefingActivityWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    ActivityConfiguration(for: BriefingActivityAttributes.self) { _ in
      StubActivityView(symbol: "sunrise", title: Self.name)
    } dynamicIsland: { _ in
      stubIsland(symbol: "sunrise", title: Self.name)
    }
  }

  private static var name: String {
    String(localized: "briefing.name", table: "Entry", bundle: .module)
  }
}
