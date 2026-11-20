import AtdAI
import AtdModel
import Foundation

/// The text side of a share: what a text command sends, how its answer reads as a list, and the
/// text the copy buttons put on the pasteboard.
enum ShareText {
  /// What a command whose result is text (缩短, 翻译, 润色, the person's own) sends for the
  /// content: `CommandPrompt`'s request with the shared image, and `values` (the version on show)
  /// over the remembered options.
  static func request(_ command: Command, values: [String: String], content: SharedContent)
    -> ModelRequest
  {
    CommandPrompt.request(
      .command(command, values: values), input: content.text, images: content.images)
  }

  /// The items of an answer that is a list, or nil when it is prose. 缩短's 要点 always reads as
  /// one, a line an item; any other answer when each of its lines starts with a list mark.
  static func items(in answer: String, isList: Bool) -> [String]? {
    let lines = answer.split(whereSeparator: \.isNewline).map { String($0).trimmed }
      .filter { !$0.isEmpty }
    let unmarked = lines.map(unmarked)
    let marked = zip(lines, unmarked).allSatisfy { $0 != $1 }
    guard isList ? !lines.isEmpty : lines.count > 1 && marked else { return nil }
    return unmarked.filter { !$0.isEmpty }
  }

  /// The line without its list mark: `·`, `•`, `-`, `*`, `–`, or a number (1. 1、 1) ①). A
  /// number that goes on (3.5 小时) is no mark.
  static func unmarked(_ line: String) -> String {
    if let first = line.first, "·•-*–—◦".contains(first) {
      return String(line.dropFirst()).trimmed
    }
    if let circled = line.unicodeScalars.first, (0x2460...0x2473).contains(circled.value) {
      return String(line.dropFirst()).trimmed
    }
    let digits = line.prefix(while: \.isASCII).prefix(while: \.isNumber)
    let rest = line.dropFirst(digits.count)
    guard !digits.isEmpty, digits.count <= 2, let mark = rest.first, ".、)）".contains(mark) else {
      return line
    }
    let after = rest.dropFirst()
    if mark == ".", after.first?.isNumber == true { return line }
    return String(after).trimmed
  }

  /// A list as copied: one `· item` a line.
  static func copyText(items: [String]) -> String {
    items.map { "· " + $0 }.joined(separator: "\n")
  }

  /// 整理白板's notes as copied: the title, each section's heading and points, then the to-dos.
  static func copyText(_ notes: NotesCard) -> String {
    var blocks = [notes.title?.trimmed].compactMap(\.self).filter { !$0.isEmpty }
    for section in notes.sections {
      blocks.append(([section.heading] + section.bullets.map { "· " + $0 }).joined(separator: "\n"))
    }
    if !notes.todos.isEmpty {
      let heading = String(localized: "notes.todos", bundle: .module)
      blocks.append(([heading] + notes.todos.map { "· " + line($0) }).joined(separator: "\n"))
    }
    return blocks.joined(separator: "\n\n")
  }

  /// A to-do with whom it is assigned to: 订桌布（小周）.
  static func line(_ todo: NotesCard.Todo) -> String {
    guard let owner = todo.owner?.trimmed, !owner.isEmpty else { return todo.text }
    return String(localized: "notes.todoOwner \(todo.text) \(owner)", bundle: .module)
  }
}
