import AtdModel
import Foundation

/// What 翻译 makes of a photo: a short title for what it shows and one item per meaningful unit
/// (a dish with its price, a sign, a sentence), top to bottom, each naming the numbered text
/// lines it came from so the camera can pin it there.
public struct CameraTranslation: Sendable, Equatable {
  public struct Item: Sendable, Equatable, Identifiable {
    /// The item's number, from 1, as its badge and pin show it.
    public var id: Int
    /// The `CameraTextLine` ids it came from; empty when the model named none that exist.
    public var lines: [Int]
    public var text: String
    /// The price as printed, such as ¥980.
    public var price: String?
    /// About what the price is in the person's currency, such as ≈46 元.
    public var approx: String?

    public init(id: Int, lines: [Int], text: String, price: String? = nil, approx: String? = nil) {
      self.id = id
      self.lines = lines
      self.text = text
      self.price = price
      self.approx = approx
    }
  }

  /// What the photo shows, such as 日文菜单.
  public var title: String?
  public var items: [Item]

  public init(title: String? = nil, items: [Item] = []) {
    self.title = title
    self.items = items
  }
}

/// Builds the request 翻译 sends from the camera: the command's own instructions, the language
/// to translate into and the answer's shape (JSON Lines, so items can be shown as they arrive),
/// with the photo and its numbered lines as the person's turn.
public enum CameraTranslatePrompt {
  /// - Parameters:
  ///   - target: the language to translate into, the command's 译成 value.
  ///   - currency: the ISO code approximate prices are given in.
  public static func request(
    _ command: Command, lines: [CameraTextLine], image: ModelImage?, target: String,
    currency: String
  ) -> ModelRequest {
    let example = Decimal(46).formatted(
      .currency(code: currency).precision(.fractionLength(0)).locale(.current))
    let system = [
      CameraPrompts.string("camera.translate.role"),
      String(localized: "prompt.instructions \(command.instructions)", bundle: .module),
      CameraPrompts.string("camera.translate.target \(target)"),
      CameraPrompts.string("camera.translate.rules \(currency) \("≈" + example)"),
    ]
    let turn = CameraPrompts.string("camera.lines.header") + "\n" + CameraText.listing(lines)
    return ModelRequest(
      system: system.joined(separator: "\n\n"),
      messages: [ModelMessage(.user, turn, images: image.map { [$0] } ?? [])])
  }
}

/// Reads a translation while it streams in. Every complete JSON object in the answer counts,
/// however the model lays them out (one per line as asked, in an array, inside a code fence or
/// pretty-printed); prose between them is ignored. The first object with only a title names the
/// photo; each object with text is an item. Line ids that name no line, or a line an earlier
/// item already took, are dropped, and long strings are cut.
public struct CameraTranslationReader: Sendable {
  public private(set) var translation = CameraTranslation()
  private let lineCount: Int
  private var buffer = ""
  private var taken = Set<Int>()

  public init(lineCount: Int) {
    self.lineCount = lineCount
  }

  /// Reads `delta`; true when the translation changed.
  @discardableResult
  public mutating func feed(_ delta: String) -> Bool {
    buffer += delta
    var changed = false
    while let object = nextObject() {
      changed = apply(object) || changed
    }
    return changed
  }

  /// The translation once the answer is complete.
  /// - Throws: `ModelFailure.unreadable` when the answer held no item.
  public func finish() throws(ModelFailure) -> CameraTranslation {
    guard !translation.items.isEmpty else { throw .unreadable(detail: "no translated items") }
    return translation
  }

  /// Removes and returns the first complete top-level object in the buffer, dropping anything
  /// before it; nil while none is complete.
  private mutating func nextObject() -> Data? {
    guard let start = buffer.firstIndex(of: "{") else {
      buffer = ""
      return nil
    }
    var depth = 0
    var inString = false
    var escaped = false
    var index = start
    while index < buffer.endIndex {
      let character = buffer[index]
      if inString {
        if escaped {
          escaped = false
        } else if character == "\\" {
          escaped = true
        } else if character == "\"" {
          inString = false
        }
      } else if character == "\"" {
        inString = true
      } else if character == "{" {
        depth += 1
      } else if character == "}" {
        depth -= 1
        if depth == 0 {
          let object = Data(buffer[start...index].utf8)
          buffer.removeSubrange(buffer.startIndex...index)
          return object
        }
      }
      index = buffer.index(after: index)
    }
    buffer.removeSubrange(buffer.startIndex..<start)
    return nil
  }

  private mutating func apply(_ object: Data) -> Bool {
    guard let raw = try? JSONDecoder().decode(RawItem.self, from: object) else { return false }
    if let text = Self.clean(raw.text, limit: 300) {
      let lines = CameraText.valid(raw.lines, lineCount: lineCount).filter { !taken.contains($0) }
      taken.formUnion(lines)
      translation.items.append(
        CameraTranslation.Item(
          id: translation.items.count + 1, lines: lines, text: text,
          price: Self.clean(raw.price, limit: 40), approx: Self.clean(raw.approx, limit: 40)))
      return true
    }
    if translation.title == nil, let title = Self.clean(raw.title, limit: 60) {
      translation.title = title
      return true
    }
    return false
  }

  private static func clean(_ text: String?, limit: Int) -> String? {
    guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
      return nil
    }
    return String(text.prefix(limit))
  }

  private struct RawItem: Decodable {
    var title: String?
    var lines: [Int] = []
    var text: String?
    var price: String?
    var approx: String?

    enum CodingKeys: String, CodingKey {
      case title, lines, text, price, approx
    }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      title = container.lenientString(.title)
      lines = container.lenientNumbers(.lines)
      text = container.lenientString(.text)
      price = container.lenientString(.price)
      approx = container.lenientString(.approx)
    }
  }
}

extension KeyedDecodingContainer {
  /// A string, or a number written as one; nil for anything else.
  func lenientString(_ key: Key) -> String? {
    if let text = try? decodeIfPresent(String.self, forKey: key) { return text }
    if let number = try? decodeIfPresent(Double.self, forKey: key) {
      return number.formatted(.number.grouping(.never))
    }
    return nil
  }

  /// Whole numbers given as a list, a single number, or numbers inside strings ("3, 4"), in any
  /// mix.
  func lenientNumbers(_ key: Key) -> [Int] {
    if let list = try? decodeIfPresent([LenientNumbers].self, forKey: key) {
      return list.flatMap(\.values)
    }
    return (try? decodeIfPresent(LenientNumbers.self, forKey: key))?.values ?? []
  }
}

/// One JSON value read as whole numbers: a number, or the runs of digits in a string.
private struct LenientNumbers: Decodable {
  var values: [Int]

  init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let number = try? container.decode(Int.self) {
      values = [number]
    } else {
      let text = try container.decode(String.self)
      values = text.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
    }
  }
}
