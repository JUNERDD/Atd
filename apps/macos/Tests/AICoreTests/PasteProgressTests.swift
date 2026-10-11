import Testing

@testable import AICore

@Suite("Paced paste progress")
struct PasteProgressTests {
  @Test("The first chunk goes in at the selection's start, or at its end after the selection")
  func insertionStart() {
    #expect(PasteProgress(selection: 10, length: 5, mode: .selection).caret == 10)
    #expect(PasteProgress(selection: 10, length: 0, mode: .cursor).caret == 10)
    #expect(PasteProgress(selection: 10, length: 3, mode: .cursor).caret == 10)
    // Read before or after the Right Arrow press that collapses it: the same end.
    #expect(PasteProgress(selection: 10, length: 5, mode: .afterSelection).caret == 15)
    #expect(PasteProgress(selection: 15, length: 0, mode: .afterSelection).caret == 15)
  }

  @Test("A chunk moves the caret by its UTF-16 length, a CRLF counted as one line break")
  func minimumAdvance() {
    #expect(PasteProgress.minimumAdvance(of: "he") == 2)
    #expect(PasteProgress.minimumAdvance(of: "👨‍👩‍👧") == 8)
    #expect(PasteProgress.minimumAdvance(of: "e\u{301}") == 2)
    #expect(PasteProgress.minimumAdvance(of: "a\r\n") == 2)
    #expect(PasteProgress.minimumAdvance(of: "\r\n") == 1)
    #expect(PasteProgress.minimumAdvance(of: "\n") == 1)
  }

  @Test("A chunk is in only once the caret passed it; the next one starts where the caret is")
  func confirmation() {
    var progress = PasteProgress(selection: 10, length: 0, mode: .cursor)
    #expect(progress.threshold(for: "he") == 12)
    let atStart = progress.confirm("he", caretAt: 10)
    #expect(!atStart)
    let partway = progress.confirm("he", caretAt: 11)
    #expect(!partway)
    #expect(progress.caret == 10)
    let reached = progress.confirm("he", caretAt: 12)
    #expect(reached)
    #expect(progress.caret == 12)
    // A field that added a space of its own: the next chunk goes in after it.
    let spaced = progress.confirm("ll", caretAt: 15)
    #expect(spaced)
    #expect(progress.threshold(for: "o") == 16)
  }

  @Test("A selection or the arrow that collapses it never passes for a pasted chunk")
  func noEarlyConfirmation() {
    // The recorded selection is still in place before the first ⌘V is handled.
    var replacing = PasteProgress(selection: 10, length: 20, mode: .selection)
    let overSelection = replacing.confirm("ab", caretAt: 10)
    #expect(!overSelection)
    let replaced = replacing.confirm("ab", caretAt: 12)
    #expect(replaced)
    // The arrow moves the caret to the selection's end before the ⌘V behind it.
    var appending = PasteProgress(selection: 10, length: 20, mode: .afterSelection)
    let atArrow = appending.confirm("ab", caretAt: 30)
    #expect(!atArrow)
    let appended = appending.confirm("ab", caretAt: 32)
    #expect(appended)
  }
}
