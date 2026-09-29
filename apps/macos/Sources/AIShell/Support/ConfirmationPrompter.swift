import AppKit

/// A native confirmation the page cannot answer: a warning `NSAlert` with its buttons in order.
/// `Choice` is what each button means to the caller.
struct ConfirmationPrompt<Choice: Sendable>: Sendable {
  struct Button: Sendable {
    let title: String
    let choice: Choice
    /// Return answers it.
    var isDefault = false
    /// Escape answers it.
    var isCancel = false
    /// Drawn as a destructive action.
    var isDestructive = false
  }

  let title: String
  let message: String
  let buttons: [Button]
}

/// Shows security confirmations one at a time, app-modally, through ``NestedRunLoop`` so main
/// actor tasks keep running while one is open. A request made while another confirmation is
/// open gets no answer (`nil`) instead of a queued dialog, so the page cannot stack prompts;
/// an alert aborted by an unattended quit answers `nil` too. Callers treat `nil` as a refusal.
@MainActor
final class ConfirmationPrompter {
  private(set) var isShowing = false

  func ask<Choice>(_ prompt: ConfirmationPrompt<Choice>) async -> Choice? {
    guard !isShowing, !prompt.buttons.isEmpty else { return nil }
    isShowing = true
    defer { isShowing = false }
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = prompt.title
    alert.informativeText = prompt.message
    for button in prompt.buttons {
      let control = alert.addButton(withTitle: button.title)
      // Only the declared buttons answer Return and Escape; NSAlert would otherwise make the
      // first button the default and match Cancel by its English title.
      control.keyEquivalent = button.isDefault ? "\r" : button.isCancel ? "\u{1b}" : ""
      control.hasDestructiveAction = button.isDestructive
    }
    // A menu bar app is often not frontmost when the page asks.
    NSApp.activate()
    let response = await NestedRunLoop.runModal(alert)
    let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
    return prompt.buttons.indices.contains(index) ? prompt.buttons[index].choice : nil
  }
}
