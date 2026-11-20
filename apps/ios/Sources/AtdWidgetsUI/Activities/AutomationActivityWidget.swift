import ActivityKit
import AtdAutomations
import SwiftUI
import WidgetKit

/// An automation run's Live Activity on the Lock Screen and in the Dynamic Island.
///
/// Stub (F0a): WS-E replaces it with the run's steps.
public struct AutomationActivityWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    ActivityConfiguration(for: AutomationActivityAttributes.self) { _ in
      StubActivityView(symbol: "flowchart", title: Self.name)
    } dynamicIsland: { _ in
      stubIsland(symbol: "flowchart", title: Self.name)
    }
  }

  private static var name: String {
    String(localized: "automation.name", table: "Automations", bundle: .module)
  }
}
