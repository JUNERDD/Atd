import Foundation

/// The text field the keyboard types into, as `UITextDocumentProxy` exposes it: a short stretch of
/// text around the cursor, the selection, and edits at the cursor. Marked text is how both pinyin
/// composition and previews of results appear in the field before they are committed.
@MainActor
public protocol DocumentEditor: AnyObject {
  /// The text before the cursor that the host shares, which may be only part of it; marked text
  /// at the cursor is included.
  var contextBeforeInput: String? { get }
  var contextAfterInput: String? { get }
  var selectedText: String? { get }
  /// Whether the field holds any text at all, marked text included.
  var hasText: Bool { get }
  /// Changes when the person moves to another field; edits never cross it.
  var documentIdentifier: UUID { get }

  /// Inserts at the cursor, replacing the selection. The session never inserts while it shows
  /// marked text: it commits or clears that first.
  func insertText(_ text: String)
  /// Deletes the selection, or the character before the cursor.
  func deleteBackward()
  /// Moves the cursor by `offset` UTF-16 code units, as `adjustTextPosition` does.
  func moveCursor(by offset: Int)
  /// Shows `text` as marked (uncommitted) text at the cursor, replacing any marked text; an
  /// empty string removes it.
  func setMarkedText(_ text: String)
  /// Commits the marked text as it is.
  func unmarkText()
}

/// The general pasteboard, as the keyboard may read it with Full Access. Reading its text can show
/// the system paste prompt; the change count and whether it holds text do not.
@MainActor
public protocol Clipboard: AnyObject {
  /// Bumped by the system on every copy.
  var changeCount: Int { get }
  var hasText: Bool { get }
  func readText() -> String?
}
