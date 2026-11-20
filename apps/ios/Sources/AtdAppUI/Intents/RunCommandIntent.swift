import AppIntents

/// 运行指令 for Siri, Shortcuts and Spotlight.
///
/// Stub (F0a) of the pattern for an intent only the app declares: only the app links AtdAppUI, so
/// an intent in this folder is in the app's App Intents metadata alone and always runs in the
/// app's process. Its copy is in the `EntryIntents` table, which project.yml compiles into the
/// app. WS-A replaces it with the real command runner.
///
/// Conforming to `AppIntent`, which is `Sendable`, makes the type nonisolated even in this
/// main-actor module; a `perform()` that touches the app's state is marked `@MainActor`. Marking
/// the type `nonisolated` would also reach its `@Parameter` properties, which cannot be.
public struct RunCommandIntent: AppIntent {
  public static let title = LocalizedStringResource("runCommand.title", table: "EntryIntents")

  @Parameter(title: LocalizedStringResource("runCommand.text", table: "EntryIntents"))
  public var text: String

  public init() {}

  public func perform() async throws -> some IntentResult & ReturnsValue<String> {
    .result(value: text)
  }
}
