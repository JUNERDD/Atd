import Foundation
import Testing

@testable import AtdPinyin

/// One mapping of the shipped lexicon for every test.
private let shipped = Result { try Lexicon.bundled() }

@Suite struct LexiconTests {
  @Test func theShippedLexiconLoads() throws {
    let lexicon = try shipped.get()
    #expect(lexicon.syllables.count == 415)
    #expect(lexicon.wordCount == 65_125)
    #expect(lexicon.syllables == lexicon.syllables.sorted())
    let zh = try #require(lexicon.ids(startingWith: "zh"))
    #expect(lexicon.syllable(zh.lowerBound) == "zha" && lexicon.syllable(zh.upperBound) == "zhuo")
    #expect(lexicon.ids(startingWith: "v") == nil)
    let ni = try #require(lexicon.id(of: "ni"))
    let words = lexicon.words(startingWith: ni...ni)
    #expect(words.allSatisfy { lexicon.syllableID($0, 0) == ni })
    #expect(words.contains { lexicon.text($0) == "你好" })
  }

  @Test func damagedFilesAreRejected() throws {
    let url = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).lexicon")
    try Data(repeating: 0, count: 64).write(to: url)
    defer { try? FileManager.default.removeItem(at: url) }
    #expect(throws: LexiconError.malformed) { try Lexicon(contentsOf: url) }
  }

  @Test func latticesKeepWholeSyllablesInitialsAndTheUnfinishedEnd() throws {
    let lexicon = try shipped.get()
    let lattice = Lattice("xian", lexicon: lexicon)
    let spellings = lattice.pieces[0].map { piece in
      String(decoding: lattice.letters[piece.start..<piece.end], as: UTF8.self)
        + (piece.isWhole ? "" : "…")
    }
    // xian is whole, and at the end it may still become xiang; x is not an abbreviation here,
    // since the i after it continues the syllable.
    #expect(Set(spellings) == ["xi", "xia", "xian", "xian…"])
    #expect(Lattice("xg", lexicon: lexicon).pieces[0].map(\.isWhole) == [false])
    let separated = Lattice("xi'an", lexicon: lexicon)
    #expect(separated.pieces[0].allSatisfy { $0.end <= 2 })
    #expect(separated.resume(2) == 3)
  }
}

@Suite struct PinyinEngineTests {
  private func engine() throws -> PinyinEngine {
    PinyinEngine(lexicon: try shipped.get())
  }

  private func first(_ letters: String, _ engine: PinyinEngine) -> PinyinCandidate? {
    engine.convert(letters, limit: 20).candidates.first
  }

  @Test(arguments: [
    ("nihao", "你好"), ("xian", "先"), ("xi'an", "西安"), ("fangan", "方案"),
    ("zhongguoren", "中国人"), ("zgr", "中国人"), ("zhongg", "中国"), ("women", "我们"),
  ])
  func commonReadingsComeFirst(letters: String, text: String) throws {
    #expect(first(letters, try engine())?.text == text)
  }

  @Test func aSentenceLeadsWhenItTakesSeveralWords() throws {
    let conversion = try engine().convert("wojintianqushangban", limit: 10)
    let sentence = try #require(conversion.candidates.first)
    #expect(sentence.kind == .sentence)
    #expect(sentence.text == "我今天去上班")
    #expect(sentence.syllables == ["wo", "jin", "tian", "qu", "shang", "ban"])
    #expect(sentence.length == 19)
    #expect(conversion.spelling == "wo'jin'tian'qu'shang'ban")
    // Then words that read the start, longest first: 握紧 (wojin) before 我 (wo).
    let words = conversion.candidates.filter { $0.kind == .word }
    #expect(words.map(\.length) == words.map(\.length).sorted(by: >))
    #expect(words.contains { $0.text == "我" && $0.length == 2 })
  }

  @Test func wordsReadTheStartAndSayHowMuch() throws {
    let conversion = try engine().convert("nihao", limit: 30)
    let ni = try #require(conversion.candidates.first { $0.text == "你" })
    #expect(ni.length == 2 && ni.kind == .word && ni.syllables == ["ni"])
    let lengths = conversion.candidates.filter { $0.kind == .word }.map(\.length)
    #expect(lengths == lengths.sorted(by: >))
    #expect(
      conversion.candidates.last
        == PinyinCandidate(text: "nihao", length: 5, syllables: [], kind: .letters))
    #expect(conversion.candidates.count <= 30)
    #expect(conversion.spelling == "ni'hao")
  }

  @Test func apostrophesAreConsumedWithTheWordBeforeThem() throws {
    let conversion = try engine().convert("xi'an", limit: 30)
    #expect(conversion.spelling == "xi'an")
    let xi = try #require(conversion.candidates.first { $0.text == "西" })
    #expect(xi.length == 3)
  }

  @Test func lettersNothingReadsStayAsTyped() throws {
    let conversion = try engine().convert("nihaov", limit: 10)
    #expect(conversion.candidates.first?.text == "你好v")
    #expect(conversion.candidates.first?.syllables == [])
    #expect(conversion.candidates.last?.text == "nihaov")
    #expect(try engine().convert("", limit: 10).candidates.isEmpty)
  }

  @Test func associationsFollowTheCommittedText() throws {
    let engine = try engine()
    #expect(engine.associations(after: "中国", limit: 10).contains("人"))
    #expect(engine.associations(after: "我", limit: 10).contains("们"))
    #expect(engine.associations(after: "我", limit: 3).count == 3)
    #expect(engine.associations(after: "@", limit: 10).isEmpty)
  }

  @Test func readingsPreferTheWholeWord() throws {
    let engine = try engine()
    #expect(engine.readings(of: "翻译") == ["fan", "yi"])
    #expect(engine.readings(of: "银行") == ["yin", "hang"])
    #expect(engine.readings(of: "缩短") == ["suo", "duan"])
    #expect(engine.readings(of: "Atd") == nil)
  }

  @Test func learnedWordsRankFirstWithoutTakingOverSentences() throws {
    var engine = try engine()
    let usual = try #require(first("ni", engine)?.text)
    #expect(usual == "你")
    engine.learn("尼", syllables: ["ni"])
    #expect(first("ni", engine)?.text == "尼")
    #expect(first("nihao", engine)?.text == "你好")

    engine.learn("张小明", syllables: ["zhang", "xiao", "ming"])
    #expect(first("zhangxiaoming", engine)?.text == "张小明")
    #expect(first("zxm", engine)?.text == "张小明")

    // Mismatched readings are not learned.
    engine.learn("你好", syllables: ["ni"])
    engine.learn("好", syllables: ["notasyllable"])
    #expect(engine.userDictionary.entries.map(\.text) == ["尼", "张小明"])

    let saved = try JSONEncoder().encode(engine.userDictionary)
    let restored = PinyinEngine(
      lexicon: try shipped.get(),
      userDictionary: try JSONDecoder().decode(UserDictionary.self, from: saved))
    #expect(first("zhangxiaoming", restored)?.text == "张小明")
  }

  @Test func theUserDictionaryForgetsTheLeastRecentlyUsed() {
    var dictionary = UserDictionary()
    let start = Date(timeIntervalSince1970: 0)
    for index in 0...UserDictionary.capacity {
      dictionary.record("词\(index)", syllables: ["ci"], at: start.addingTimeInterval(Double(index)))
    }
    #expect(dictionary.entries.count == UserDictionary.capacity)
    #expect(!dictionary.entries.contains { $0.text == "词0" })
    dictionary.record("词1", syllables: ["ci"], at: start.addingTimeInterval(10_000))
    #expect(dictionary.entries.first { $0.text == "词1" }?.count == 2)
  }

  @Test func longInputsStayQuick() throws {
    let engine = try engine()
    let clock = ContinuousClock()
    let elapsed = clock.measure {
      _ = engine.convert("woxiangyaodingyizhangmingtianqubeijingdejipiao", limit: 30)
      _ = engine.convert("sssssssssssssssssssss", limit: 30)
    }
    #expect(elapsed < .seconds(2))
  }
}
