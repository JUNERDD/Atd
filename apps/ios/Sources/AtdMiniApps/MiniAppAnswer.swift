import Foundation

/// The model's answer to a build or refine request, read as it streams in.
///
/// The answer is plain text in sections, each opened by a marker alone on its line
/// (`[[ABOUT]]`, `[[DATA]]`, `[[PAGE]]`, `[[WIDGET]]`, `[[END]]`): plain text streams on both
/// provider protocols and keeps a page's HTML unescaped. Text before the first marker is
/// ignored, and a section is complete once the next marker arrives, which is what the build
/// steps show.
public struct MiniAppAnswer: Sendable, Equatable {
  public enum Section: String, Sendable, CaseIterable {
    case about = "ABOUT"
    case data = "DATA"
    case page = "PAGE"
    case widget = "WIDGET"
    case end = "END"
  }

  /// The markers seen so far, in order.
  public private(set) var markers: [Section] = []
  private var lines: [Section: [String]] = [:]
  private var current: Section?
  /// The text after the last line break, which may still grow.
  private var pending = ""

  public init() {}

  /// A finished answer, all at once.
  public init(_ text: String) {
    append(text)
    finish()
  }

  public mutating func append(_ delta: String) {
    pending += delta
    while let newline = pending.firstIndex(where: \.isNewline) {
      let line = String(pending[..<newline])
      pending = String(pending[pending.index(after: newline)...])
      take(line)
    }
  }

  /// Reads the last line, once the stream has ended.
  public mutating func finish() {
    if !pending.isEmpty { take(pending) }
    pending = ""
  }

  public var isComplete: Bool { markers.contains(.end) }

  public func has(_ section: Section) -> Bool {
    lines[section] != nil
  }

  /// A section's text, without blank lines around it or a code fence a model put around it.
  public func content(_ section: Section) -> String? {
    guard var lines = lines[section] else { return nil }
    while let first = lines.first, first.trimmingCharacters(in: .whitespaces).isEmpty {
      lines.removeFirst()
    }
    while let last = lines.last, last.trimmingCharacters(in: .whitespaces).isEmpty {
      lines.removeLast()
    }
    if let first = lines.first, first.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
      lines.removeFirst()
    }
    if let last = lines.last, last.trimmingCharacters(in: .whitespaces) == "```" {
      lines.removeLast()
    }
    return lines.joined(separator: "\n")
  }

  /// The `key: value` lines of `[[ABOUT]]`, keys in lowercase.
  public var about: [String: String] {
    var values: [String: String] = [:]
    for line in (content(.about) ?? "").split(whereSeparator: \.isNewline) {
      let parts = line.split(maxSplits: 1, whereSeparator: { $0 == ":" || $0 == "：" })
      guard parts.count == 2 else { continue }
      let key = parts[0].trimmingCharacters(in: .whitespaces).lowercased()
      let value = parts[1].trimmingCharacters(in: .whitespaces)
      if !key.isEmpty, !value.isEmpty, values[key] == nil { values[key] = value }
    }
    return values
  }

  /// `ideas: a | b | c`, at most three.
  public var ideas: [String]? {
    about["ideas"].map { line in
      line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }.prefix(3).map { String($0.prefix(40)) }
    }
  }

  /// A section's JSON: the whole text, or from its first `{` to its last `}` when the model put
  /// words around it.
  public func json(_ section: Section) -> MiniAppJSON? {
    guard let text = content(section) else { return nil }
    if let json = MiniAppJSON.parse(text) { return json }
    guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"), start < end
    else { return nil }
    return MiniAppJSON.parse(String(text[start...end]))
  }

  /// This answer with `section` replaced by the same section of `repair`.
  public func replacing(_ section: Section, from repair: MiniAppAnswer) -> MiniAppAnswer {
    var answer = self
    answer.lines[section] = repair.lines[section]
    return answer
  }

  /// How many of a new app's four steps are done: 理解需求 once `[[DATA]]` starts, 设计数据
  /// once `[[PAGE]]` does, 生成界面 at `[[WIDGET]]` and 生成小组件 at `[[END]]`.
  public var buildProgress: Int {
    let order: [Section] = [.data, .page, .widget, .end]
    return markers.compactMap { order.firstIndex(of: $0).map { $0 + 1 } }.max() ?? 0
  }

  /// How many of a refinement's three steps are done: 理解改动 once anything follows
  /// `[[ABOUT]]`, 修改界面 once the widget or the end does, 更新小组件 at `[[END]]`. A
  /// refinement leaves out what it does not change, so the steps follow what arrives.
  public var refineProgress: Int {
    let after = markers.contains { $0 != .about } ? 1 : 0
    let late = markers.contains { $0 == .widget || $0 == .end } ? 1 : 0
    return after + late + (isComplete ? 1 : 0)
  }

  private mutating func take(_ line: String) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("[["), let close = trimmed.range(of: "]]"),
      let section = Section(
        rawValue: String(trimmed[trimmed.index(trimmed.startIndex, offsetBy: 2)..<close.lowerBound])
          .uppercased())
    {
      current = section
      markers.append(section)
      if lines[section] == nil { lines[section] = [] }
      let rest = trimmed[close.upperBound...].trimmingCharacters(in: .whitespaces)
      if !rest.isEmpty { lines[section, default: []].append(rest) }
      return
    }
    // Prose before the first marker, and anything after the end, is not part of the app.
    guard let current, current != .end else { return }
    lines[current, default: []].append(line)
  }
}
