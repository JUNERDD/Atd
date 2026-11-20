import Foundation

/// What the keyboard needs from a pinyin engine. `PinyinEngine` is the built-in one; another
/// engine (librime, say) can take its place behind this protocol.
public protocol PinyinConverting {
  /// Reads typed letters (a–z, with `'` between syllables where the person typed one).
  func convert(_ letters: String, limit: Int) -> PinyinConversion
  /// What often follows `text`, as the text to add after it, best first.
  func associations(after text: String, limit: Int) -> [String]
  /// The pinyin of each character of `text`, or nil when one has none.
  func readings(of text: String) -> [String]?
  /// Remembers a phrase the person committed, so it ranks higher from now on.
  mutating func learn(_ text: String, syllables: [String])
}

public struct PinyinConversion: Sendable, Equatable {
  /// The typed letters cut into syllables for the marked text: `ni'hao`.
  public var spelling: String
  /// The full sentence (when it takes several words), then words that read the start of the
  /// letters, longest first, then the letters as typed.
  public var candidates: [PinyinCandidate]

  public init(spelling: String, candidates: [PinyinCandidate]) {
    self.spelling = spelling
    self.candidates = candidates
  }
}

public struct PinyinCandidate: Sendable, Equatable, Hashable {
  public enum Kind: Sendable, Hashable {
    /// The best reading of all the letters, in several words.
    case sentence
    /// A word reading the start of the letters.
    case word
    /// The letters themselves, for a word in another language.
    case letters
  }

  public var text: String
  /// How many typed characters (letters and apostrophes) it stands for, from the start.
  public var length: Int
  /// One syllable per character; empty for the letters themselves.
  public var syllables: [String]
  public var kind: Kind

  public init(text: String, length: Int, syllables: [String], kind: Kind) {
    self.text = text
    self.length = length
    self.syllables = syllables
    self.kind = kind
  }
}

/// Phrases the person committed, kept by the keyboard in its own container so they rank higher
/// next time (and so phrases the lexicon lacks, like names, become words). Nothing here leaves
/// the device.
public struct UserDictionary: Codable, Sendable, Equatable {
  public struct Entry: Codable, Sendable, Equatable {
    public var text: String
    public var syllables: [String]
    public var count: Int
    public var lastUsed: Date
  }

  /// The most entries kept; the least recently used go first.
  public static let capacity = 2_000

  public private(set) var entries: [Entry]

  public init(entries: [Entry] = []) {
    self.entries = entries
  }

  mutating func record(_ text: String, syllables: [String], at date: Date) {
    if let index = entries.firstIndex(where: { $0.text == text && $0.syllables == syllables }) {
      entries[index].count += 1
      entries[index].lastUsed = date
      return
    }
    entries.append(Entry(text: text, syllables: syllables, count: 1, lastUsed: date))
    if entries.count > Self.capacity,
      let oldest = entries.indices.min(by: { entries[$0].lastUsed < entries[$1].lastUsed })
    {
      entries.remove(at: oldest)
    }
  }
}
