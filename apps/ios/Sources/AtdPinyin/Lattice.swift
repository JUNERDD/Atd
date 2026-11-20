/// One way to read a stretch of the typed letters: a whole syllable, or the start of one.
struct Piece: Equatable {
  var start: Int
  var end: Int
  /// The syllables it can stand for.
  var ids: ClosedRange<UInt16>
  /// A whole syllable, rather than an initial or a syllable still being typed.
  var isWhole: Bool
}

/// Every way to cut typed letters into syllables: whole syllables anywhere, initials standing for
/// a syllable (zgr → 中国人), and at the very end the start of the syllable still being typed
/// (zhongg → 中国).
/// An apostrophe the person typed is a fixed boundary between syllables.
struct Lattice {
  static let apostrophe = UInt8(ascii: "'")

  /// Initials that stand for any syllable they start, as in 简拼.
  private static let initials: Set<String> = [
    "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "zh", "ch", "sh", "r",
    "z", "c", "s", "y", "w",
  ]

  /// The typed letters as ASCII bytes.
  let letters: [UInt8]
  /// The pieces that start at each position.
  let pieces: [[Piece]]

  init(_ input: String, lexicon: Lexicon) {
    let letters = Array(input.utf8)
    var pieces = [[Piece]](repeating: [], count: letters.count + 1)
    for start in letters.indices where letters[start] != Self.apostrophe {
      var end = start + 1
      while end <= letters.count, end - start <= 7, letters[end - 1] != Self.apostrophe {
        let text = String(decoding: letters[start..<end], as: UTF8.self)
        // No syllable starts this way, so no longer stretch can be one either.
        guard let range = lexicon.ids(startingWith: text) else { break }
        let whole = lexicon.id(of: text)
        if let whole {
          pieces[start].append(Piece(start: start, end: end, ids: whole...whole, isWhole: true))
        }
        let atEnd = end == letters.count
        let canBeUnfinished = atEnd || Self.isAbbreviation(text, followedBy: letters[end], lexicon)
        if canBeUnfinished, whole == nil || range.count > 1 {
          pieces[start].append(Piece(start: start, end: end, ids: range, isWhole: false))
        }
        end += 1
      }
    }
    self.letters = letters
    self.pieces = pieces
  }

  /// Whether an initial stands for a whole syllable (简拼): only when the next letter cannot
  /// continue it: zgr is 中国人, but the j of jin is never read as j + in.
  private static func isAbbreviation(_ text: String, followedBy next: UInt8, _ lexicon: Lexicon)
    -> Bool
  {
    guard initials.contains(text) else { return false }
    return next == apostrophe
      || lexicon.ids(startingWith: text + String(UnicodeScalar(next))) == nil
  }

  /// Where the next syllable can start after `position`: past any apostrophes.
  func resume(_ position: Int) -> Int {
    var position = position
    while position < letters.count, letters[position] == Self.apostrophe { position += 1 }
    return position
  }

  /// The ways syllable ids `ids` (from `slot` on) can continue a word whose earlier syllables
  /// ended at `position`: calls `found` with where the word ends and how many of its pieces were
  /// unfinished.
  func follow(
    syllable ids: (Int) -> UInt16, from slot: Int, of count: Int, at position: Int,
    unfinished: Int, found: (_ end: Int, _ unfinished: Int) -> Void
  ) {
    guard slot < count else {
      found(position, unfinished)
      return
    }
    let id = ids(slot)
    for piece in pieces[resume(position)] where piece.ids.contains(id) {
      follow(
        syllable: ids, from: slot + 1, of: count, at: piece.end,
        unfinished: unfinished + (piece.isWhole ? 0 : 1), found: found)
    }
  }

  /// The ends of the pieces a word with syllable `ids` uses from `start` to `end`, for spelling.
  func pieceEnds(_ ids: [UInt16], from start: Int, to end: Int) -> [Int]? {
    guard let id = ids.first else { return start == end ? [] : nil }
    for piece in pieces[resume(start)] where piece.ids.contains(id) && piece.end <= end {
      if let rest = pieceEnds(Array(ids.dropFirst()), from: piece.end, to: end) {
        return [piece.end] + rest
      }
    }
    return nil
  }
}
