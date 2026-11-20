import AtdModel
import Foundation

/// The commands the share sheet offers for what was shared: the best fit first (建议), the rest
/// under 其他指令, each with a line saying what it will do.
///
/// Every command placed in the share sheet that can run there is listed (`lists(_:)`, A43); the
/// kind of content only orders them: the prototype's built-ins for it first, then the commands
/// made for that kind of content, then the rest, each group in library order.
struct ShareMenu: Equatable {
  struct Entry: Equatable, Identifiable {
    var command: Command
    /// What the command will do here: the date found (提取日程), 译成英文, its instructions.
    var subtitle: String

    var id: String { command.id }
  }

  var suggested: Entry?
  var others: [Entry]

  var isEmpty: Bool { suggested == nil }

  init(
    commands: [Command], content: SharedContent, now: Date = .now,
    calendar: Calendar = .current, locale: Locale = .current
  ) {
    let text = content.readableText
    let dates = text.map { Self.dates(in: $0) } ?? []
    // A18: a text with no date in it is unlikely to hold an event.
    let ranked = Self.ranked(
      commands.filter(Self.lists), for: content, eventLast: text != nil && dates.isEmpty)
    let upcoming = dates.sorted().first { $0 >= calendar.startOfDay(for: now) }
    let entries = ranked.map {
      Entry(
        command: $0, subtitle: Self.subtitle(of: $0, upcoming, calendar: calendar, locale: locale))
    }
    suggested = entries.first
    others = Array(entries.dropFirst())
  }

  /// Whether the share sheet lists `command`: its share switch is on and it can run there, which
  /// takes some input (A43). Root swaps the second half for `Command.runs(on: .share)` at merge.
  static func lists(_ command: Command) -> Bool {
    command.placement.share && command.input != .none
  }

  /// Whether `command` is made for this kind of content, which ranks it before the others: by
  /// its input, except that 翻译 and 缩短 also read the text in an image and 润色 rewrites only
  /// text, not a page or an image.
  static func suits(_ command: Command, _ content: SharedContent) -> Bool {
    let isImage = if case .image = content { true } else { false }
    switch command.id {
    case BuiltinCommands.translateID, BuiltinCommands.shortenID: return true
    case BuiltinCommands.polishID: return if case .text = content { true } else { false }
    default: break
    }
    switch command.input {
    case .shared: return true
    case .image: return isImage
    case .text, .copied: return !isImage
    case .none: return false
    }
  }

  /// The prototype's built-ins for the content in its order, then the commands that suit it, then
  /// the others.
  private static func ranked(_ commands: [Command], for content: SharedContent, eventLast: Bool)
    -> [Command]
  {
    var order: [String]
    switch content {
    case .page:
      order = [BuiltinCommands.eventID, BuiltinCommands.shortenID, BuiltinCommands.translateID]
    case .image:
      order = [
        BuiltinCommands.eventID, BuiltinCommands.translateID, BuiltinCommands.shortenID,
        BuiltinCommands.expenseID, BuiltinCommands.whiteboardID,
      ]
    case .text:
      order = [
        BuiltinCommands.eventID, BuiltinCommands.shortenID, BuiltinCommands.translateID,
        BuiltinCommands.polishID,
      ]
    }
    if eventLast {
      order.removeAll { $0 == BuiltinCommands.eventID }
      order.append(BuiltinCommands.eventID)
    }
    let first = order.compactMap { id in commands.first { $0.id == id } }
    let rest = commands.filter { !order.contains($0.id) }
    return first + rest.filter { suits($0, content) } + rest.filter { !suits($0, content) }
  }

  private static func subtitle(
    of command: Command, _ upcoming: Date?, calendar: Calendar, locale: Locale
  ) -> String {
    switch command.id {
    case BuiltinCommands.eventID:
      if let upcoming {
        let style = Date.FormatStyle(
          locale: locale, calendar: calendar, timeZone: calendar.timeZone)
        return upcoming.formatted(style.month(.abbreviated).day().weekday(.abbreviated))
      }
    case BuiltinCommands.shortenID:
      // The share sheet starts 缩短 at 要点.
      return String(localized: "menu.shorten", bundle: .module)
    case BuiltinCommands.translateID:
      if let target = command.option(BuiltinCommands.OptionKey.language)?.value {
        return String(localized: "menu.translate \(target)", bundle: .module)
      }
    default:
      break
    }
    return command.instructions.oneLine ?? ""
  }

  /// The dates `NSDataDetector` finds in the text, on the device.
  static func dates(in text: String) -> [Date] {
    guard
      let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue)
    else { return [] }
    return detector.matches(in: text, range: NSRange(text.startIndex..., in: text))
      .compactMap(\.date)
  }
}
