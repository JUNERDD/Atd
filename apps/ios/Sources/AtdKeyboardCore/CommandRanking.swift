import AtdModel

/// Orders the commands the strip offers by what the person just did (IME.md: context ranks the
/// strip).
enum CommandRanking {
  /// Whether the keyboard can run a command: it reads the field, the clipboard or nothing, and
  /// its result goes into the field.
  static func isSupported(_ command: Command) -> Bool {
    [.text, .copied, .none].contains(command.input)
      && [.replace, .insert].contains(command.output.action)
  }

  /// The commands that have something to work on: a command for a copy made since the clipboard
  /// was last read leads, then the commands for the field's text, then commands for an older
  /// copy. Within each group the library's order holds.
  static func chips(
    _ commands: [Command], readable: String, copied: ClipboardSnapshot, seen: Int?
  ) -> [CommandChip] {
    let hasText = !readable.trimmed.isEmpty
    let fresh = copied.hasText && copied.changeCount != seen
    let ranked = commands.filter(isSupported).compactMap { command -> (Int, CommandChip)? in
      switch command.input {
      case .copied:
        guard copied.hasText else { return nil }
        return (fresh ? 0 : 2, CommandChip(command: command, readsFreshCopy: fresh))
      case .text:
        return hasText ? (1, CommandChip(command: command, readsFreshCopy: false)) : nil
      default:
        return (1, CommandChip(command: command, readsFreshCopy: false))
      }
    }
    // A stable sort by group: `sorted` alone does not keep the library's order.
    return ranked.enumerated()
      .sorted { ($0.element.0, $0.offset) < ($1.element.0, $1.offset) }
      .map(\.element.1)
  }
}

/// Whether typed letters spell a name, so the ✦ line finds commands and phrases by pinyin: the
/// pinyin of the name from its start (fanyi, fany → 翻译), or the initials of its characters
/// from any one of them (fy → 翻译, hf → 帮我回复). Two letters at least, so single letters
/// keep typing. A name without pinyin matches the start of one of its words (po → Polish).
enum NameMatching {
  static func spells(_ typed: String, name: String, readings: [String]?) -> Bool {
    let letters = typed.lowercased().filter { $0 != "'" }
    guard letters.count >= 2 else { return false }
    guard let readings, !readings.isEmpty else {
      return name.lowercased().split(whereSeparator: { !$0.isLetter }).contains {
        $0.hasPrefix(letters)
      }
    }
    if readings.joined().hasPrefix(letters) { return true }
    return readings.indices.contains { start in
      String(readings[start...].compactMap(\.first)).hasPrefix(letters)
    }
  }
}
