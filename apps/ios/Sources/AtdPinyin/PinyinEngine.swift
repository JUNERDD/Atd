import Foundation

/// The built-in engine. Words come from the lexicon and from the phrases the person taught it; a
/// sentence is the most likely sequence of words over every way to cut the letters (a unigram
/// Viterbi search, where each word adds its log weight and pays the log of the total weight, so
/// one long word beats several short ones of the same reading).
///
/// Scores are natural logs in units of 1/2000, the lexicon's scale.
public struct PinyinEngine: PinyinConverting {
  /// What a syllable that was only begun (an initial, or the one still being typed) costs, so
  /// whole syllables read first.
  static let unfinishedCost = 3_000
  /// What leaving a letter unread costs: more than any reading.
  static let strayLetterCost = 20_000
  /// Where a taught phrase the lexicon lacks starts, below the total weight's log.
  static let taughtBase = -12_000

  public let lexicon: Lexicon
  public private(set) var userDictionary: UserDictionary
  private var taught: [Taught]

  /// A phrase from the user dictionary, read into syllable ids and a score.
  struct Taught {
    var text: String
    var ids: [UInt16]
    var syllables: [String]
    var score: Int
    var lastUsed: Date
  }

  public init(lexicon: Lexicon, userDictionary: UserDictionary = UserDictionary()) {
    self.lexicon = lexicon
    self.userDictionary = userDictionary
    taught = Self.taught(from: userDictionary, lexicon)
  }

  public func convert(_ letters: String, limit: Int) -> PinyinConversion {
    let lattice = Lattice(letters, lexicon: lexicon)
    guard !lattice.letters.isEmpty else { return PinyinConversion(spelling: "", candidates: []) }
    let matches = lattice.letters.indices.map { start in
      lattice.letters[start] == Lattice.apostrophe ? [] : self.matches(from: start, lattice)
    }
    let path = bestPath(lattice, matches)
    var candidates: [PinyinCandidate] = []
    if path.count(where: { lattice.letters[$0.start] != Lattice.apostrophe }) > 1 {
      candidates.append(sentence(path, lattice))
    }
    let words = matches[0].sorted(by: Self.isBefore).map { match in
      PinyinCandidate(
        text: text(match.source), length: lattice.resume(match.end),
        syllables: syllables(match.source), kind: .word)
    }
    var seen = Set(candidates.map(\.text))
    for word in words where candidates.count < max(limit - 1, 1) && seen.insert(word.text).inserted
    {
      candidates.append(word)
    }
    candidates.append(
      PinyinCandidate(text: letters, length: lattice.letters.count, syllables: [], kind: .letters))
    return PinyinConversion(spelling: spelling(path, lattice), candidates: candidates)
  }

  public func associations(after text: String, limit: Int) -> [String] {
    let characters = Array(text)
    for length in stride(from: min(characters.count, 3), through: 1, by: -1) {
      let context = String(characters.suffix(length))
      let words = lexicon.textRanks(startingWith: context)
        .map { lexicon.word(atTextRank: $0) }
        .filter { lexicon.textBytes($0).count > context.utf8.count }
        .sorted { lexicon.score($0) > lexicon.score($1) }
      var seen = Set<String>()
      let following = words.map { String(lexicon.text($0).dropFirst(length)) }
        .filter { seen.insert($0).inserted }
      if !following.isEmpty { return Array(following.prefix(limit)) }
    }
    return []
  }

  public func readings(of text: String) -> [String]? {
    if let word = exactWord(text), lexicon.syllableCount(word) == text.count {
      return lexicon.syllables(of: word)
    }
    var readings: [String] = []
    for character in text {
      guard let word = exactWord(String(character)), lexicon.syllableCount(word) == 1 else {
        return nil
      }
      readings += lexicon.syllables(of: word)
    }
    return readings
  }

  public mutating func learn(_ text: String, syllables: [String]) {
    guard (1...8).contains(syllables.count), syllables.count == text.count,
      syllables.allSatisfy({ lexicon.id(of: $0) != nil })
    else { return }
    userDictionary.record(text, syllables: syllables, at: .now)
    taught = Self.taught(from: userDictionary, lexicon)
  }

  // MARK: Matching

  /// A word that reads the letters from some start to `end`.
  struct Match {
    enum Source: Hashable {
      case word(Int)
      case taught(Int)
    }
    var source: Source
    var end: Int
    /// Its score as one word of a sentence, before the per-word cost.
    var score: Int
    /// For ordering taught phrases among themselves.
    var lastUsed: Date?
  }

  /// Every word, from the lexicon and taught, that reads the letters from `start` on.
  private func matches(from start: Int, _ lattice: Lattice) -> [Match] {
    var found: [Match] = []
    var index: [Pair: Int] = [:]
    func add(_ match: Match) {
      let key = Pair(source: match.source, end: match.end)
      if let existing = index[key] {
        found[existing].score = max(found[existing].score, match.score)
      } else {
        index[key] = found.count
        found.append(match)
      }
    }
    for first in lattice.pieces[start] {
      let firstCost = first.isWhole ? 0 : Self.unfinishedCost
      for word in lexicon.words(startingWith: first.ids) {
        lattice.follow(
          syllable: { lexicon.syllableID(word, $0) }, from: 1, of: lexicon.syllableCount(word),
          at: first.end, unfinished: 0,
          found: { end, unfinished in
            let score = lexicon.score(word) - firstCost - unfinished * Self.unfinishedCost
            add(Match(source: .word(word), end: end, score: score))
          })
      }
    }
    for (number, phrase) in taught.enumerated() {
      lattice.follow(
        syllable: { phrase.ids[$0] }, from: 0, of: phrase.ids.count, at: start, unfinished: 0,
        found: { end, unfinished in
          let score = phrase.score - unfinished * Self.unfinishedCost
          add(Match(source: .taught(number), end: end, score: score, lastUsed: phrase.lastUsed))
        })
    }
    return found
  }

  private struct Pair: Hashable {
    var source: Match.Source
    var end: Int
  }

  /// Longest first; at one length, what the person taught (most recent first), then by score.
  private static func isBefore(_ left: Match, _ right: Match) -> Bool {
    if left.end != right.end { return left.end > right.end }
    switch (left.lastUsed, right.lastUsed) {
    case (let left?, let right?): return left > right
    case (.some, nil): return true
    case (nil, .some): return false
    case (nil, nil): return left.score > right.score
    }
  }

  // MARK: Sentences

  /// One step of a reading: a word, a typed apostrophe, or a letter left unread.
  struct Step {
    var start: Int
    var end: Int
    var match: Match?
  }

  private func bestPath(_ lattice: Lattice, _ matches: [[Match]]) -> [Step] {
    let count = lattice.letters.count
    var best = [Int?](repeating: nil, count: count + 1)
    var previous = [Step?](repeating: nil, count: count + 1)
    best[0] = 0
    func relax(_ step: Step, _ score: Int) {
      if let current = best[step.end], current >= score { return }
      best[step.end] = score
      previous[step.end] = step
    }
    for start in 0..<count {
      guard let reached = best[start] else { continue }
      if lattice.letters[start] == Lattice.apostrophe {
        relax(Step(start: start, end: start + 1), reached)
        continue
      }
      for match in matches[start] {
        relax(
          Step(start: start, end: match.end, match: match), reached + match.score - lexicon.logTotal
        )
      }
      relax(Step(start: start, end: start + 1), reached - lexicon.logTotal - Self.strayLetterCost)
    }
    var path: [Step] = []
    var position = count
    while position > 0, let step = previous[position] {
      path.append(step)
      position = step.start
    }
    return path.reversed()
  }

  private func sentence(_ path: [Step], _ lattice: Lattice) -> PinyinCandidate {
    var text = ""
    var syllables: [String]? = []
    for step in path where lattice.letters[step.start] != Lattice.apostrophe {
      if let match = step.match {
        text += self.text(match.source)
        syllables? += self.syllables(match.source)
      } else {
        // A letter nothing reads stays as typed, and the sentence has no reading to learn.
        text += String(decoding: lattice.letters[step.start..<step.end], as: UTF8.self)
        syllables = nil
      }
    }
    return PinyinCandidate(
      text: text, length: lattice.letters.count, syllables: syllables ?? [], kind: .sentence)
  }

  /// The letters cut where the best reading cuts them: `ni'hao`.
  private func spelling(_ path: [Step], _ lattice: Lattice) -> String {
    var spelling = ""
    func separate() {
      if !spelling.isEmpty, spelling.last != "'" { spelling += "'" }
    }
    for step in path {
      if lattice.letters[step.start] == Lattice.apostrophe {
        separate()
        continue
      }
      let ends = step.match.flatMap {
        lattice.pieceEnds(ids($0.source), from: step.start, to: step.end)
      }
      var from = step.start
      for end in ends ?? [step.end] {
        separate()
        spelling += String(decoding: lattice.letters[lattice.resume(from)..<end], as: UTF8.self)
        from = end
      }
    }
    return spelling
  }

  // MARK: Sources

  private func text(_ source: Match.Source) -> String {
    switch source {
    case .word(let word): lexicon.text(word)
    case .taught(let number): taught[number].text
    }
  }

  private func syllables(_ source: Match.Source) -> [String] {
    switch source {
    case .word(let word): lexicon.syllables(of: word)
    case .taught(let number): taught[number].syllables
    }
  }

  private func ids(_ source: Match.Source) -> [UInt16] {
    switch source {
    case .word(let word): (0..<lexicon.syllableCount(word)).map { lexicon.syllableID(word, $0) }
    case .taught(let number): taught[number].ids
    }
  }

  /// The best-scoring lexicon word whose text is exactly `text`.
  private func exactWord(_ text: String) -> Int? {
    guard let first = lexicon.textRanks(startingWith: text).first else { return nil }
    let word = lexicon.word(atTextRank: first)
    return lexicon.textBytes(word).count == text.utf8.count ? word : nil
  }

  private static func taught(from dictionary: UserDictionary, _ lexicon: Lexicon) -> [Taught] {
    dictionary.entries.compactMap { entry in
      let ids = entry.syllables.compactMap { lexicon.id(of: $0) }
      guard ids.count == entry.syllables.count else { return nil }
      // A phrase the lexicon has keeps its weight; a new one starts high enough to read as one
      // word rather than the pieces it was typed in. Each use adds the log of the count.
      let known = lexicon.textRanks(startingWith: entry.text)
        .map { lexicon.word(atTextRank: $0) }
        .first { word in
          lexicon.textBytes(word).count == entry.text.utf8.count
            && lexicon.syllableCount(word) == ids.count
            && (0..<ids.count).allSatisfy { lexicon.syllableID(word, $0) == ids[$0] }
        }
      let base = known.map(lexicon.score) ?? lexicon.logTotal + taughtBase
      let bonus = Int((log(Double(1 + entry.count)) * 2_000).rounded())
      return Taught(
        text: entry.text, ids: ids, syllables: entry.syllables, score: base + bonus,
        lastUsed: entry.lastUsed)
    }
  }
}
