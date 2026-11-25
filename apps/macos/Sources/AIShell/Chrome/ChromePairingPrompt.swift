import AICore
import Foundation

/// The native confirmation that pairs a Chrome profile (D4): trust grants are the shell's own
/// alerts, never the extension's or a page's. It shares ``ConfirmationPrompter`` with every other
/// security confirmation, so it never stacks on one; a request made while any dialog, a system
/// panel or a capture is open is refused as busy rather than queued, and after the person turned a
/// request down no profile may ask again before ``cooldown`` passed, so an extension cannot nag,
/// not even under a fresh installation id.
final class ChromePairingPrompt {
  enum Outcome: Equatable {
    case allowed
    case denied
    case busy
    case cooldown
  }

  static let cooldown: Duration = .seconds(30)

  private let confirmations: ConfirmationPrompter
  /// Whether another surface owns the screen: a system panel or a capture.
  private let screenBusy: () -> Bool
  private var deniedAt: ContinuousClock.Instant?
  private var asking = false

  init(confirmations: ConfirmationPrompter, screenBusy: @escaping () -> Bool) {
    self.confirmations = confirmations
    self.screenBusy = screenBusy
  }

  /// Asks whether the profile `label` (its account or name; nil when the browser reports neither)
  /// in `browser` (signed by `developer`) may connect, naming the `code` the extension shows.
  /// Cancel is the default (Return and Escape) in the trailing place, as in every prompt that
  /// grants access.
  func ask(label: String?, browser: String, developer: String, code: String) async -> Outcome {
    if let deniedAt, ContinuousClock.now - deniedAt < Self.cooldown { return .cooldown }
    guard !asking, !confirmations.isShowing, !screenBusy() else { return .busy }
    asking = true
    defer { asking = false }
    let strings = ShellStrings.shared
    let locale = Locale(identifier: strings.language.rawValue)
    let message =
      if let label {
        String(
          format: strings.text(ChromeChannelStringKey.chromePairMessage), locale: locale, label,
          browser, developer, code)
      } else {
        String(
          format: strings.text(ChromeChannelStringKey.chromePairMessageUnnamed), locale: locale,
          browser, developer, code)
      }
    let prompt = ConfirmationPrompt<Bool>(
      title: strings.text(ChromeChannelStringKey.chromePairTitle), message: message,
      buttons: [
        .init(title: strings.text(.cancel), choice: false, isDefault: true, isCancel: true),
        .init(title: strings.text(ChromeChannelStringKey.chromePairAllow), choice: true),
      ])
    switch await confirmations.ask(prompt) {
    case true?:
      deniedAt = nil
      return .allowed
    case false?:
      deniedAt = .now
      return .denied
    case nil:
      return .busy
    }
  }
}
