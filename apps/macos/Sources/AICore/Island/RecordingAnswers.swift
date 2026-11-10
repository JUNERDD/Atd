/// The built-in asks under the result card's field (R10), each sent as its localized question.
public enum RecordingQuickAsk: String, CaseIterable, Sendable {
  case reproductionSteps, summary, automation
}

/// An ask the card sends: the orchestrator runs it as a light task on the kept range's files
/// (`recording.ask`) and reports its answer back by `id`.
public struct RecordingAsk: Equatable, Sendable {
  /// The ask's id, the page's `askId`.
  public let id: String
  public let question: String
  /// The range kept when it was asked, which its files cover.
  public let range: RecordingTrim
  /// A regeneration's: the ask it replaces, whose page it takes over.
  public let replacing: String?

  public init(id: String, question: String, range: RecordingTrim, replacing: String? = nil) {
    self.id = id
    self.question = question
    self.range = range
    self.replacing = replacing
  }
}

extension RecordingAsk: CardAsk {}

/// Two asks about trims equal to the handles' finest nudge are about the same range.
extension RecordingTrim: CardAskRange {
  public var askKey: [Int] { key }
}

/// One answer page of the recording card's answer slot (``CardAnswer``).
public typealias RecordingAnswer = CardAnswer<RecordingTrim, RecordingQuickAsk>

/// The recording card's one answer slot (``CardAnswers``).
public typealias RecordingAnswers = CardAnswers<RecordingAsk, RecordingQuickAsk>

/// Where an answer names a time on its own ("0:04" or, from an hour on, "1:05:10", as
/// ``RecordingClock`` writes them; not one end of a range like "0:02–0:04"), which the slot
/// turns into a link that seeks the player there (`record-answer.js`).
public enum RecordingAnswerTimes {
  /// A time in `text`: its character offsets and the seconds it names.
  public struct Mark: Equatable, Sendable {
    public let offset: Int
    public let length: Int
    public let seconds: Double
  }

  public static func marks(in text: String) -> [Mark] {
    let characters = Array(text)
    var marks: [Mark] = []
    var index = 0
    while index < characters.count {
      guard let length = time(at: index, in: characters) else {
        index += 1
        continue
      }
      let written = String(characters[index..<index + length])
      if let seconds = RecordingClock.seconds(Substring(written)) {
        marks.append(Mark(offset: index, length: length, seconds: seconds))
      }
      index += length
    }
    return marks
  }

  /// The length of a lone `m:ss` or `h:mm:ss` starting at `index`, or nil. Hours have the
  /// same unbounded digit count as the formatter; the parser validates their numeric value.
  private static func time(at index: Int, in characters: [Character]) -> Int? {
    if index > 0, joins(characters[index - 1]) { return nil }
    var lead = index
    while lead < characters.count, characters[lead].isASCIIDigit { lead += 1 }
    guard lead > index else { return nil }
    // Then one or two `:ss` groups: seconds, or minutes and seconds after hours.
    var end = lead
    while end - lead < 6, end + 3 <= characters.count, characters[end] == ":",
      characters[end + 1..<end + 3].allSatisfy(\.isASCIIDigit)
    {
      end += 3
    }
    guard end > lead else { return nil }
    if end - lead == 3, lead - index > 2 { return nil }
    if end < characters.count, joins(characters[end]) { return nil }
    return end - index
  }

  /// A character that makes a neighbouring time part of something longer: a digit, a colon, or
  /// a range's dash.
  private static func joins(_ character: Character) -> Bool {
    character.isASCIIDigit || character == ":" || character == "–" || character == "-"
  }
}

extension Character {
  fileprivate var isASCIIDigit: Bool { isASCII && isNumber }
}
