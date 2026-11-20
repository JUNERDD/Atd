import AppIntents
import AtdModel

/// 随手问 for Siri, Shortcuts and the Action button: opens 问 Atd over the app, with `text`
/// waiting in the field. `supportedModes` brings the app forward, unlocking first, before
/// `perform()` runs. The control runs `AskControlIntent` instead (Package.swift has the rule).
public struct OpenAskIntent: AppIntent {
  public static let title = LocalizedStringResource("openAsk.title", table: "EntryIntents")
  public static let supportedModes: IntentModes = .foreground

  @Parameter(title: LocalizedStringResource("openAsk.text", table: "EntryIntents"))
  public var text: String?

  public init() {}

  @MainActor
  public func perform() async throws -> some IntentResult {
    RouteCenter.shared.open(.ask(text: text))
    return .result()
  }
}
