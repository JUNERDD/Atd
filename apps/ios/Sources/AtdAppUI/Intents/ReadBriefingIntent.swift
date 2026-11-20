import AppIntents
import AtdIntents
import AtdModel
import SwiftUI

/// 今日简报 for Siri and Shortcuts: today's events and reminders in three sentences, spoken,
/// shown and returned as text, so a shortcut can read them aloud or pass them on. The
/// control and the widget run `BriefingIntent`, which answers in a Live Activity instead.
public struct ReadBriefingIntent: AppIntent {
  public static let title = LocalizedStringResource("briefing.title", table: "EntryIntents")
  public static let authenticationPolicy = IntentAuthenticationPolicy.alwaysAllowed
  public static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  public init() {}

  @MainActor
  public func perform() async throws
    -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView
  {
    do {
      let context = try EntryContext.live()
      let command = try context.command(BuiltinCommands.briefingID)
      if CommandRun.briefingNeedsAsking(context.reader) {
        // The system asks for access only while Atd is in front.
        try await continueInForeground(nil, alwaysConfirm: false)
      }
      let card = try await CommandRun(context).card(command, asking: true)
      let lines = CardText.lines(card)
      let text = lines.joined(separator: "\n")
      return .result(
        value: text, dialog: IntentDialog("\(text)"),
        view: CardSnippet(command: command, lines: lines))
    } catch {
      throw IntentFailure(error) ?? error
    }
  }
}
