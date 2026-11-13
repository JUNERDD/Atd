import AppKit

/// A text storage showing one rendering of a result text brought to the next: replaced from the
/// first character whose text or attributes differ, never whole, so what precedes that keeps its
/// layout and any selection in it. The comparison is with the rendering shown last rather than
/// the storage, whose attributes TextKit fixes (a font substituted for characters the system
/// font lacks) as it lays them out.
enum ResultTextEdit {
  /// The first UTF-16 offset where `new` differs from `old`, at the start of a composed
  /// character; nil where they are the same.
  static func firstChange(from old: NSAttributedString, to new: NSAttributedString) -> Int? {
    if old === new { return nil }
    let oldString = old.string as NSString
    let newString = new.string as NSString
    let prefix = commonPrefix(oldString, newString)
    // Run by run through Core Foundation: no attribute dictionary is bridged, and the runs a
    // render shares with the last one compare by identity first.
    let oldRuns = old as CFAttributedString
    let newRuns = new as CFAttributedString
    var index = 0
    while index < prefix {
      var oldRun = CFRange()
      var newRun = CFRange()
      let oldAttributes = CFAttributedStringGetAttributes(oldRuns, index, &oldRun)
      let newAttributes = CFAttributedStringGetAttributes(newRuns, index, &newRun)
      guard CFEqual(oldAttributes, newAttributes) else { break }
      index = min(oldRun.location + oldRun.length, newRun.location + newRun.length, prefix)
    }
    if index == oldString.length, index == newString.length { return nil }
    if index < newString.length {
      index = min(index, newString.rangeOfComposedCharacterSequence(at: index).location)
    }
    if index < oldString.length {
      index = min(index, oldString.rangeOfComposedCharacterSequence(at: index).location)
    }
    return index
  }

  /// Replaces everything in `storage` from `start` on with `new` from there.
  static func apply(_ new: NSAttributedString, from start: Int, to storage: NSTextStorage) {
    let tail = new.attributedSubstring(from: NSRange(start..<new.length))
    storage.beginEditing()
    storage.replaceCharacters(in: NSRange(start..<storage.length), with: tail)
    storage.endEditing()
  }

  /// `ranges` as far as they stay before `start`: one reaching past it ends there, one after it
  /// goes.
  static func clamp(_ ranges: [NSRange], before start: Int) -> [NSRange] {
    ranges.compactMap { range in
      if NSMaxRange(range) <= start { return range }
      if range.location < start { return NSRange(range.location..<start) }
      return nil
    }
  }

  /// The length of the UTF-16 prefix `a` and `b` share.
  private static func commonPrefix(_ a: NSString, _ b: NSString) -> Int {
    let limit = min(a.length, b.length)
    let chunk = 512
    var left = [unichar](repeating: 0, count: chunk)
    var right = [unichar](repeating: 0, count: chunk)
    var offset = 0
    while offset < limit {
      let length = min(chunk, limit - offset)
      a.getCharacters(&left, range: NSRange(location: offset, length: length))
      b.getCharacters(&right, range: NSRange(location: offset, length: length))
      for index in 0..<length where left[index] != right[index] { return offset + index }
      offset += length
    }
    return limit
  }
}
