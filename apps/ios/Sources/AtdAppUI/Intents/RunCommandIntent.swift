import AppIntents
import AtdAI
import AtdActions
import AtdIntents
import AtdModel
import SwiftUI
import UIKit

/// 运行指令 for Siri, Shortcuts and Spotlight: runs a command on the text or photo it is given,
/// or on the clipboard for a command that reads it, and answers with the result as text, a
/// spoken line and a snippet. An event is added to Calendar and an expense logged in its book,
/// after the person confirms when the command previews first. Nothing is donated.
///
/// Only the app declares it (this folder), so it always runs in the app's process: in the
/// background, unless the clipboard or a first request for access needs the app in front.
public struct RunCommandIntent: AppIntent {
  public static let title = LocalizedStringResource("runCommand.title", table: "EntryIntents")
  public static let authenticationPolicy = IntentAuthenticationPolicy.requiresAuthentication
  public static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: LocalizedStringResource("runCommand.command", table: "EntryIntents"))
  public var command: CommandEntity

  @Parameter(
    title: LocalizedStringResource("runCommand.text", table: "EntryIntents"),
    inputConnectionBehavior: .connectToPreviousIntentResult)
  public var text: String?

  @Parameter(
    title: LocalizedStringResource("runCommand.image", table: "EntryIntents"),
    supportedContentTypes: [.image])
  public var image: IntentFile?

  public init() {}

  @MainActor
  public func perform() async throws
    -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView
  {
    do {
      let context = try EntryContext.live()
      let command = try context.command(self.command.id)
      let input = try await resolvedInput(for: command)
      if command.id == BuiltinCommands.briefingID, CommandRun.briefingNeedsAsking(context.reader) {
        // The system asks for access only while Atd is in front.
        try await continueInForeground(nil, alwaysConfirm: false)
      }
      let card = try await CommandRun(context).card(
        command, text: input.text, images: input.images, asking: true)
      let snippet = CardSnippet(command: command, lines: CardText.lines(card))
      let dialog = try await act(on: card, of: command, store: context.store, snippet: snippet)
      return .result(value: CardText.text(card), dialog: dialog, view: snippet)
    } catch {
      throw IntentFailure(error) ?? error
    }
  }

  /// What the command runs on. Siri asks for missing text; only the app in front may read the
  /// clipboard, so a command that reads it brings Atd forward when no text came with the run.
  @MainActor
  private func resolvedInput(for command: Command) async throws -> (
    text: String, images: [ModelImage]
  ) {
    let askForImage = $image.needsValueError(
      IntentDialog(LocalizedStringResource("ask.image", table: "EntryIntents")))
    switch CommandInputNeed(command.input, text: text, hasImage: image != nil) {
    case .ready:
      break
    case .text:
      throw $text.needsValueError(
        IntentDialog(LocalizedStringResource("ask.text", table: "EntryIntents")))
    case .image:
      throw askForImage
    case .clipboard:
      try await continueInForeground(nil, alwaysConfirm: false)
      let copied = UIPasteboard.general.string ?? ""
      guard copied.contains(where: { !$0.isWhitespace }) else { throw IntentFailure.emptyClipboard }
      return (copied, [])
    }
    guard command.input == .image else { return (command.input == .none ? "" : text ?? "", []) }
    // A file that is not a photo Atd can read counts as no photo.
    guard let image, let encoded = await ImageEncoding.modelImage(from: image.data) else {
      throw askForImage
    }
    return (text ?? "", [encoded])
  }

  /// Does what the card is for and says so: adds the event, logs the expense, or speaks the
  /// result itself.
  @MainActor
  private func act(
    on card: CardResult, of command: Command, store: SharedStore, snippet: CardSnippet
  ) async throws -> IntentDialog {
    switch card {
    case .event(let draft):
      if command.output.review {
        try await requestConfirmation(
          actionName: .add,
          dialog: IntentDialog(LocalizedStringResource("confirm.event", table: "EntryIntents"))
        ) { @Sendable in snippet }
      }
      let writer = CalendarWriter()
      if writer.access == .notDetermined {
        try await continueInForeground(nil, alwaysConfirm: false)
      }
      _ = try await writer.add(draft)
      return IntentDialog(LocalizedStringResource("dialog.added", table: "EntryIntents"))
    case .expense(let draft):
      if command.output.review {
        try await requestConfirmation(
          actionName: .add,
          dialog: IntentDialog(
            LocalizedStringResource("confirm.expense \(draft.book)", table: "EntryIntents"))
        ) { @Sendable in snippet }
      }
      try LedgerBook(store: store).add(draft, source: .intent)
      return IntentDialog(
        LocalizedStringResource("dialog.logged \(draft.book)", table: "EntryIntents"))
    case .notes(let notes):
      return IntentDialog("\(notes.title ?? command.name)")
    case .text, .briefing:
      return IntentDialog("\(CardText.text(card))")
    }
  }
}
