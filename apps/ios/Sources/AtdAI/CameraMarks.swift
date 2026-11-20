import AtdModel
import Foundation

/// A part of a card the camera can mark on the photo.
public enum CameraMarkField: Sendable, Equatable, Hashable {
  case merchant, time, total
  case date, place
  /// A whiteboard's section, by its position from 1.
  case section(Int)
}

/// A numbered box on the photo around the text lines a part of the card was read from. Parts
/// read from the same lines (a receipt's date and time on one line) share one box and number.
public struct CameraMark: Sendable, Equatable, Identifiable {
  public var number: Int
  public var fields: [CameraMarkField]
  public var lines: [Int]

  public var id: Int { number }

  public init(number: Int, fields: [CameraMarkField], lines: [Int]) {
    self.number = number
    self.fields = fields
    self.lines = lines
  }
}

/// The `"marks"` key the camera asks card commands for, read leniently: a mark that does not
/// decode is skipped, and missing marks only leave the photo unmarked.
public struct CameraMarkFields: Decodable, Sendable, Equatable {
  public struct Raw: Decodable, Sendable, Equatable {
    public var field: String?
    public var section: Int?
    public var lines: [Int]

    enum CodingKeys: String, CodingKey {
      case field, section, lines
    }

    public init(field: String? = nil, section: Int? = nil, lines: [Int]) {
      self.field = field
      self.section = section
      self.lines = lines
    }

    public init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      field = container.lenientString(.field)?.lowercased()
      section = container.lenientNumbers(.section).first
      lines = container.lenientNumbers(.lines)
    }
  }

  public var marks: [Raw]

  enum CodingKeys: String, CodingKey {
    case marks
  }

  public init(marks: [Raw]) {
    self.marks = marks
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let items = (try? container.decode([Lenient].self, forKey: .marks)) ?? []
    marks = items.compactMap(\.raw)
  }

  private struct Lenient: Decodable {
    var raw: Raw?

    init(from decoder: any Decoder) throws {
      raw = try? Raw(from: decoder)
    }
  }
}

/// The marks the camera asks a card command for and how it numbers them.
public enum CameraMarks {
  /// The rule appended to the card's system prompt (`CardRunner`'s `asking:`), asking for the
  /// numbered lines each part came from; nil for a kind the camera does not mark.
  public static func rule(for kind: CardKind) -> String? {
    switch kind {
    case .expense: CameraPrompts.string("camera.marks.expense")
    case .event: CameraPrompts.string("camera.marks.event")
    case .notes: CameraPrompts.string("camera.marks.notes")
    case .briefing, .text: nil
    }
  }

  /// Numbers the marks for `card` in its kind's order (商家, 时间, 合计; 日期, 时间, 地点; the
  /// sections in order). A part the card does not have, or whose lines name none of the
  /// `lineCount` lines, gets no mark and no number; parts read from the same lines share one.
  public static func marks(_ fields: CameraMarkFields?, for card: CardResult, lineCount: Int)
    -> [CameraMark]
  {
    guard let fields else { return [] }
    var marks: [CameraMark] = []
    for field in order(of: card) {
      let lines = CameraText.valid(
        fields.marks.filter { matches($0, field) }.flatMap(\.lines), lineCount: lineCount
      ).sorted()
      guard !lines.isEmpty else { continue }
      if let index = marks.firstIndex(where: { $0.lines == lines }) {
        marks[index].fields.append(field)
      } else {
        marks.append(CameraMark(number: marks.count + 1, fields: [field], lines: lines))
      }
    }
    return marks
  }

  /// The parts of `card` that can be marked, in the order they are numbered.
  static func order(of card: CardResult) -> [CameraMarkField] {
    switch card {
    case .expense(let draft):
      return (draft.merchant == nil ? [] : [.merchant]) + [.time, .total]
    case .event(let draft):
      return [.date] + (draft.isAllDay ? [] : [.time]) + (draft.location == nil ? [] : [.place])
    case .notes(let notes):
      return notes.sections.indices.map { .section($0 + 1) }
    case .briefing, .text:
      return []
    }
  }

  private static func matches(_ raw: CameraMarkFields.Raw, _ field: CameraMarkField) -> Bool {
    switch field {
    case .section(let position):
      raw.section == position
    case .merchant: raw.field == "merchant"
    case .time: raw.field == "time"
    case .total: raw.field == "total" || raw.field == "amount"
    case .date: raw.field == "date"
    case .place: raw.field == "place" || raw.field == "location"
    }
  }
}
