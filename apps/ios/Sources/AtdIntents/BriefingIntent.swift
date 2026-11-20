import AppIntents
import AtdModel

/// 今日简报 from its control and the 常用指令 widget: runs in the background and shows its
/// progress and its three sentences in a Live Activity, without unlocking. Siri and Shortcuts run
/// `ReadBriefingIntent`, which answers in words instead.
///
/// A `LiveActivityIntent`: the system runs it in the app's process, launched in the background,
/// which may start and update Live Activities. The control and the widget button that trigger it
/// live in the widget extension, so AtdIntents puts it in both bundles.
public struct BriefingIntent: LiveActivityIntent {
  public static let title = LocalizedStringResource("briefing.title", table: "EntryIntents")
  public static let isDiscoverable = false
  public static let authenticationPolicy = IntentAuthenticationPolicy.alwaysAllowed
  /// In the foreground only when Live Activities are off, to show the briefing in Atd (A26).
  public static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  public init() {}

  @MainActor
  public func perform() async throws -> some IntentResult {
    try await ControlRun.perform(commandID: BuiltinCommands.briefingID, for: self)
    return .result()
  }
}
