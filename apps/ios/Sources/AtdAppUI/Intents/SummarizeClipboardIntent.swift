import AppIntents
import AtdIntents
import SwiftUI
import UIKit

/// 总结剪贴板 (the prototype's Siri flow): after unlocking, Atd reads the clipboard, sums it up in
/// at most three points and offers 拷贝 and 打开 Atd under them. The request is fixed and runs on
/// the default model, so editing 缩短 does not change it.
public struct SummarizeClipboardIntent: AppIntent {
  public static let title = LocalizedStringResource("summarize.title", table: "EntryIntents")
  public static let authenticationPolicy = IntentAuthenticationPolicy.requiresAuthentication
  public static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  /// Text a shortcut passes on, summed up instead of the clipboard.
  @Parameter(
    title: LocalizedStringResource("summarize.text", table: "EntryIntents"),
    inputConnectionBehavior: .connectToPreviousIntentResult)
  public var text: String?

  public init() {}

  @MainActor
  public func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    do {
      let source = try await sourceText()
      let context = try EntryContext.live()
      let points = try await ClipboardSummary.summarize(source, with: context.generator)
      let summary = points.joined(separator: "\n")
      let copy = IntentChoiceOption(
        title: LocalizedStringResource("choice.copy", table: "EntryIntents"))
      let open = IntentChoiceOption(
        title: LocalizedStringResource("choice.open", table: "EntryIntents"))
      let snippet = CardSnippet(
        name: String(localized: Self.title), symbol: "doc.on.clipboard", lines: points)
      let choice = try await requestChoice(
        between: [copy, open], dialog: IntentDialog("\(summary)"), view: snippet)
      if choice == open {
        try await continueInForeground(nil, alwaysConfirm: false)
        return .result(value: summary, dialog: IntentDialog("\(summary)"))
      }
      UIPasteboard.general.string = summary
      return .result(
        value: summary,
        dialog: IntentDialog(LocalizedStringResource("dialog.copied", table: "EntryIntents")))
    } catch {
      throw IntentFailure(error) ?? error
    }
  }

  /// The text passed in, else the clipboard, which only the app in front may read.
  @MainActor
  private func sourceText() async throws -> String {
    if let text, text.contains(where: { !$0.isWhitespace }) { return text }
    try await continueInForeground(nil, alwaysConfirm: false)
    let copied = UIPasteboard.general.string ?? ""
    guard copied.contains(where: { !$0.isWhitespace }) else { throw IntentFailure.emptyClipboard }
    return copied
  }
}
