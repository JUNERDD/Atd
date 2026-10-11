/// How a paced `text.write` paste knows that a chunk is in the target field, so the next one may
/// replace it on the pasteboard: the field's caret, read through Accessibility in UTF-16 units,
/// moved past it. Only that proves the target's ⌘V ran. The pasteboard being read proves nothing,
/// since any process may read it (a clipboard manager, Universal Clipboard), and a chunk taken as
/// in before the target pasted it makes that ⌘V paste the next chunk instead, dropping text.
///
/// A paste replaces the field's selection, so a chunk goes in at the selection's start, or at its
/// end for `afterSelection`, which collapses the selection there first; the caret then sits at
/// least the chunk's length further on. "At least" admits what a field adds on its own, such as
/// smart spacing; the next chunk goes in wherever the caret actually is. A field without a
/// readable caret gets the text in one paste (``TypingPace``). How long a chunk may take to show
/// in is ``TypingPace/confirmationLimit(for:pastedAt:)``, so a slow field cannot hold the write
/// past its deadline.
public struct PasteProgress: Equatable, Sendable {
  /// Where the next chunk goes in, in UTF-16 units.
  public private(set) var caret: Int

  /// The progress of a paste into a field whose selection before the first chunk is `location`
  /// and `length`. For `afterSelection` the selection may be read before or after the Right Arrow
  /// press that collapses it is handled; the chunk goes in at its end either way.
  public init(selection location: Int, length: Int, mode: TextWriteParams.Mode) {
    caret = mode == .afterSelection ? location + length : location
  }

  /// The fewest UTF-16 units `chunk` moves the caret: its length, with each "\r\n" counted once,
  /// since a field may store it as a single line break. At least 1 for a non-empty chunk.
  public static func minimumAdvance(of chunk: String) -> Int {
    chunk.utf16.count - chunk.reduce(0) { $1 == "\r\n" ? $0 + 1 : $0 }
  }

  /// The caret location at or past which `chunk`, pasted next, is in.
  public func threshold(for chunk: String) -> Int {
    caret + Self.minimumAdvance(of: chunk)
  }

  /// Takes `chunk` as in when the caret, now at `location`, reached its threshold, and moves the
  /// progress there; false, changing nothing, while it has not.
  public mutating func confirm(_ chunk: String, caretAt location: Int) -> Bool {
    guard location >= threshold(for: chunk) else { return false }
    caret = location
    return true
  }
}
