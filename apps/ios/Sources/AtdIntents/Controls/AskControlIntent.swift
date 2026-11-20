import AppIntents
import AtdModel

/// 随手问's control: opens 问 Atd over the app with an empty field.
///
/// The widget extension declares it too, for the control, so it stays out of Siri and Shortcuts,
/// which run `OpenAskIntent` (Package.swift has the rule). `supportedModes` brings the app
/// forward, unlocking first, before `perform()` runs there.
public struct AskControlIntent: AppIntent {
  public static let title = LocalizedStringResource("openAsk.title", table: "EntryIntents")
  public static let isDiscoverable = false
  public static let supportedModes: IntentModes = .foreground

  public init() {}

  @MainActor
  public func perform() async throws -> some IntentResult {
    RouteCenter.shared.open(.ask(text: nil))
    return .result()
  }
}
