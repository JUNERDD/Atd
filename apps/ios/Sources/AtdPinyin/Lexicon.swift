import Foundation

public enum LexiconError: Error, Equatable {
  case unreadable(path: String)
  case malformed
}

/// The pinyin lexicon (`Lexicon/README.md` has the format), mapped read-only from its file and
/// read in place: only the pages a lookup touches become resident, and the system can drop them
/// again under memory pressure.
public final class Lexicon: @unchecked Sendable {
  // Unchecked: the mapping is read-only and nothing in this class changes after `init`.
  private let base: UnsafeRawPointer
  private let size: Int
  private let wordOffset: Int
  private let textIndexOffset: Int
  private let textOffset: Int
  /// Syllables in id order (id 1 is `syllables[0]`).
  let syllables: [String]
  private let ids: [String: UInt16]
  let wordCount: Int
  /// ln(total weight) in score units: what one more word costs a sentence.
  let logTotal: Int

  /// The lexicon this module ships.
  public static func bundled() throws -> Lexicon {
    guard let url = Bundle.module.url(forResource: "pinyin", withExtension: "lexicon") else {
      throw LexiconError.unreadable(path: "pinyin.lexicon")
    }
    return try Lexicon(contentsOf: url)
  }

  public init(contentsOf url: URL) throws {
    let path = url.path(percentEncoded: false)
    let descriptor = open(path, O_RDONLY)
    guard descriptor >= 0 else { throw LexiconError.unreadable(path: path) }
    defer { close(descriptor) }
    var status = stat()
    guard fstat(descriptor, &status) == 0, status.st_size >= 48 else {
      throw LexiconError.malformed
    }
    let size = Int(status.st_size)
    guard let mapped = mmap(nil, size, PROT_READ, MAP_PRIVATE, descriptor, 0),
      mapped != UnsafeMutableRawPointer(bitPattern: -1)
    else { throw LexiconError.unreadable(path: path) }
    let base = UnsafeRawPointer(mapped)
    let header = (0..<8).map { field in
      Int(UInt32(littleEndian: base.loadUnaligned(fromByteOffset: 8 + field * 4, as: UInt32.self)))
    }
    let magic = String(decoding: UnsafeRawBufferPointer(start: base, count: 8), as: UTF8.self)
    let (syllableCount, wordCount, syllableOffset) = (header[0], header[1], header[2])
    let (wordOffset, textIndexOffset, textOffset) = (header[3], header[4], header[5])
    guard magic == "ATDPY001", syllableOffset + syllableCount * 8 == wordOffset,
      wordOffset + wordCount * 16 == textIndexOffset, textIndexOffset + wordCount * 4 == textOffset,
      textOffset + header[6] == size
    else {
      munmap(mapped, size)
      throw LexiconError.malformed
    }
    let syllables = (0..<syllableCount).map { index in
      let offset = syllableOffset + index * 8
      let length = Int(base.load(fromByteOffset: offset, as: UInt8.self))
      return String(
        decoding: UnsafeRawBufferPointer(start: base + offset + 1, count: min(length, 7)),
        as: UTF8.self)
    }
    self.base = base
    self.size = size
    self.wordOffset = wordOffset
    self.textIndexOffset = textIndexOffset
    self.textOffset = textOffset
    self.syllables = syllables
    self.wordCount = wordCount
    logTotal = header[7]
    ids = Dictionary(uniqueKeysWithValues: syllables.enumerated().map { ($1, UInt16($0 + 1)) })
  }

  deinit {
    munmap(UnsafeMutableRawPointer(mutating: base), size)
  }

  // MARK: Syllables

  func id(of syllable: some StringProtocol) -> UInt16? {
    ids[String(syllable)]
  }

  func syllable(_ id: UInt16) -> String {
    syllables[Int(id) - 1]
  }

  /// The ids of every syllable that starts with `prefix`: a contiguous range, since ids follow
  /// alphabetical order.
  func ids(startingWith prefix: some StringProtocol) -> ClosedRange<UInt16>? {
    let prefix = String(prefix)
    var low = 0
    var high = syllables.count
    while low < high {
      let middle = (low + high) / 2
      if syllables[middle] < prefix { low = middle + 1 } else { high = middle }
    }
    var end = low
    while end < syllables.count, syllables[end].hasPrefix(prefix) { end += 1 }
    guard end > low else { return nil }
    return UInt16(low + 1)...UInt16(end)
  }

  // MARK: Words

  /// The id of syllable `slot` (0–3) of a word, or 0 past its end.
  func syllableID(_ word: Int, _ slot: Int) -> UInt16 {
    UInt16(
      littleEndian: base.loadUnaligned(
        fromByteOffset: wordOffset + word * 16 + slot * 2, as: UInt16.self))
  }

  func syllableCount(_ word: Int) -> Int {
    Int(base.load(fromByteOffset: wordOffset + word * 16 + 8, as: UInt8.self))
  }

  func score(_ word: Int) -> Int {
    Int(
      UInt16(
        littleEndian: base.loadUnaligned(
          fromByteOffset: wordOffset + word * 16 + 10, as: UInt16.self)))
  }

  func textBytes(_ word: Int) -> UnsafeRawBufferPointer {
    let record = wordOffset + word * 16
    let length = Int(base.load(fromByteOffset: record + 9, as: UInt8.self))
    let offset = Int(
      UInt32(littleEndian: base.loadUnaligned(fromByteOffset: record + 12, as: UInt32.self)))
    return UnsafeRawBufferPointer(start: base + textOffset + offset, count: length)
  }

  func text(_ word: Int) -> String {
    String(decoding: textBytes(word), as: UTF8.self)
  }

  func syllables(of word: Int) -> [String] {
    (0..<syllableCount(word)).map { syllable(syllableID(word, $0)) }
  }

  /// The words whose first syllable is in `first`, in lexicon order.
  func words(startingWith first: ClosedRange<UInt16>) -> Range<Int> {
    partition {
      syllableID($0, 0) >= first.lowerBound
    }..<partition { syllableID($0, 0) > first.upperBound }
  }

  // MARK: Text index

  /// The word at `rank` in text order.
  func word(atTextRank rank: Int) -> Int {
    Int(
      UInt32(
        littleEndian: base.loadUnaligned(
          fromByteOffset: textIndexOffset + rank * 4, as: UInt32.self)
      ))
  }

  /// The text ranks of the words that start with `prefix` (the word equal to it first, then the
  /// longer ones), each group by score.
  func textRanks(startingWith prefix: String) -> Range<Int> {
    var prefix = prefix
    return prefix.withUTF8 { prefix in
      let key = UnsafeRawBufferPointer(prefix)
      return partition {
        compare(word(atTextRank: $0), key) >= 0
      }..<partition { compare(word(atTextRank: $0), key) > 0 }
    }
  }

  /// Orders a word's text against a prefix: 0 when it starts with it.
  private func compare(_ word: Int, _ prefix: UnsafeRawBufferPointer) -> Int {
    let text = textBytes(word)
    let shared = min(text.count, prefix.count)
    if shared > 0, let left = text.baseAddress, let right = prefix.baseAddress {
      let order = memcmp(left, right, shared)
      if order != 0 { return Int(order) }
    }
    return text.count >= prefix.count ? 0 : -1
  }

  /// The first word index for which `isAfter` holds, given that it holds for a suffix of words.
  private func partition(_ isAfter: (Int) -> Bool) -> Int {
    var low = 0
    var high = wordCount
    while low < high {
      let middle = (low + high) / 2
      if isAfter(middle) { high = middle } else { low = middle + 1 }
    }
    return low
  }
}
