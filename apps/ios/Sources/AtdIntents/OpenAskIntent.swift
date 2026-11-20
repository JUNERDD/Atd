import AppIntents
import AtdModel

/// 随手问: opens 问 Atd over the app, with `text` waiting in the field.
///
/// Stub (F0a) of the pattern for an intent that opens the app, such as a control's: it lives in
/// AtdIntents so the widget extension (the control) and the app (which runs it) both declare it,
/// and `supportedModes` brings the app forward before `perform()` runs there. WS-A replaces it.
public struct OpenAskIntent: AppIntent {
  public static let title = LocalizedStringResource("openAsk.title", table: "EntryIntents")
  public static let supportedModes: IntentModes = .foreground(.immediate)

  @Parameter(title: LocalizedStringResource("openAsk.text", table: "EntryIntents"))
  public var text: String?

  public init() {}

  @MainActor
  public func perform() async throws -> some IntentResult {
    RouteCenter.shared.open(.ask(text: text))
    return .result()
  }
}
