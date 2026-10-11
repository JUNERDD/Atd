/// Whether the element a summon found focused can take text (`ShortcutCommandEvent.Target`'s
/// `writable`), from what Accessibility answered about it. Only evidence makes it read-only:
/// web content outside an editable region has no `AXEditableAncestor`, and a read-only text
/// view, a web page's body or an element that is not text at all lets neither its value nor its
/// selected text be set. Its selected range does not count, since read-only views let the
/// selection move. A native text role (a text field, a text area, a combo box) is never taken
/// for evidence: terminals and other custom text engines refuse both attributes yet take a
/// paste, and the write confirms a paste that went in (a read-only text view never reads it).
/// Anything the shell could not learn (a timeout, an error) leaves it writable too, and the
/// write itself then says whether the text went in.
public enum WriteTargetWritability {
  /// What `AXEditableAncestor` answered.
  public enum Ancestor: Equatable, Sendable {
    /// An editable element contains the focus (or is it).
    case present
    /// The element has none, or does not support the attribute.
    case absent
    /// No answer: a timeout or another error.
    case unknown
  }

  /// What `AXUIElementIsAttributeSettable` answered for an attribute.
  public enum Settable: Equatable, Sendable {
    case settable
    case notSettable
    /// The element does not support the attribute.
    case unsupported
    /// No answer: a timeout or another error.
    case unknown

    /// The element showed it does not take this attribute.
    var refuses: Bool { self == .notSettable || self == .unsupported }
  }

  /// The Accessibility roles of native text elements, which the rule leaves to the write.
  public static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox"]

  /// False only when the element has no editable ancestor, is not a native text element
  /// (`role`; nil when it did not say), and refuses both its value and its selected text; true
  /// otherwise.
  public static func writable(
    ancestor: Ancestor, role: String?, value: Settable, selectedText: Settable
  ) -> Bool {
    !(ancestor == .absent && !isText(role) && value.refuses && selectedText.refuses)
  }

  /// Whether the next question is worth asking: once an answer makes the element writable (an
  /// editable ancestor, a native text role, a settable attribute, no answer at all), the others
  /// cannot change it.
  public static func decided(by ancestor: Ancestor) -> Bool { ancestor != .absent }

  /// The same for the element's role.
  public static func decided(by role: String?) -> Bool { isText(role) }

  private static func isText(_ role: String?) -> Bool { role.map(textRoles.contains) ?? false }

  /// The same for an attribute's answer.
  public static func decided(by settable: Settable) -> Bool { !settable.refuses }
}
