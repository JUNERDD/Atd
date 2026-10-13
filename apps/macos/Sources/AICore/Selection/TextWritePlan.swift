/// What `text.write` knows about its target before it changes anything.
public struct TextWriteFacts: Equatable, Sendable {
  /// The app is trusted for Accessibility.
  public var trusted: Bool
  /// The target is recorded, not expired, and its app still runs.
  public var targetAvailable: Bool
  /// Secure event input is on (a password field somewhere has the keyboard).
  public var secureInput: Bool
  /// The target recorded a non-empty selected range or selected text.
  public var hasSelection: Bool

  public init(trusted: Bool, targetAvailable: Bool, secureInput: Bool, hasSelection: Bool) {
    self.trusted = trusted
    self.targetAvailable = targetAvailable
    self.secureInput = secureInput
    self.hasSelection = hasSelection
  }
}

/// The pure rules of `text.write` (contract: `text-calls.ts`): which refusal comes first, and what
/// gets pasted for each mode.
public enum TextWritePlan {
  /// The first refusal that applies, in the contract's order, or nil when the write may go ahead.
  public static func refusal(_ mode: TextWriteParams.Mode, _ facts: TextWriteFacts)
    -> TextWriteResult.NotOk.Reason?
  {
    guard facts.trusted else { return .notTrusted }
    guard facts.targetAvailable else { return .targetGone }
    guard !facts.secureInput else { return .secureInput }
    if mode != .cursor, !facts.hasSelection { return .noSelection }
    return nil
  }

  /// The text to paste. After a selection it is set apart: by a blank line when the selection
  /// spans lines, by a space otherwise.
  public static func insertion(of text: String, mode: TextWriteParams.Mode, selectedText: String?)
    -> String
  {
    guard mode == .afterSelection else { return text }
    let multiline = selectedText?.contains(where: \.isNewline) ?? false
    return (multiline ? "\n\n" : " ") + text
  }
}
