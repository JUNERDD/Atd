import ActivityKit
import AtdAutomations
import SwiftUI
import WidgetKit

/// The NFC focus timer's Live Activity on the Lock Screen and in the Dynamic Island.
///
/// Stub (F0a): WS-E replaces it with the running timer.
public struct FocusActivityWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    ActivityConfiguration(for: FocusActivityAttributes.self) { _ in
      StubActivityView(symbol: "timer", title: Self.name)
    } dynamicIsland: { _ in
      stubIsland(symbol: "timer", title: Self.name)
    }
  }

  private static var name: String {
    String(localized: "focus.name", table: "Automations", bundle: .module)
  }
}
