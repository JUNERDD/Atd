import AppIntents

/// A widget button that only rereads what the widget shows.
///
/// Stub (F0a) of the pattern for an interactive widget button: a plain intent, which the system
/// runs in the widget extension's process and follows with a reload of that widget's timeline.
/// Apple has it declared by the app as well, so the same button works in the app. Hidden from
/// Shortcuts and Spotlight, where it means nothing. Owners replace it with their buttons.
public struct RefreshWidgetIntent: AppIntent {
  public static let title = LocalizedStringResource("refreshWidget.title", table: "EntryIntents")
  public static let isDiscoverable = false

  public init() {}

  public func perform() async throws -> some IntentResult {
    .result()
  }
}
