import ActivityKit
import AppIntents

/// 今日简报: runs in the background and shows its progress and its three sentences in a Live
/// Activity, without unlocking.
///
/// Stub (F0a) of the pattern for a `LiveActivityIntent`: the system runs it in the app's process
/// (launched in the background), which may start and update Live Activities; the control and the
/// widget button that trigger it live in the widget extension, so AtdIntents puts it in both
/// bundles. WS-A replaces the body with the briefing run.
public struct BriefingIntent: LiveActivityIntent {
  public static let title = LocalizedStringResource("briefing.title", table: "EntryIntents")

  public init() {}

  public func perform() async throws -> some IntentResult {
    .result()
  }
}

/// What 今日简报's Live Activity shows. Stub (F0a): WS-A defines the attributes and the state.
public struct BriefingActivityAttributes: ActivityAttributes, Sendable {
  public struct ContentState: Codable, Hashable, Sendable {
    public init() {}
  }

  public init() {}
}
