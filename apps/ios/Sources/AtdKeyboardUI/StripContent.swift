import AtdAI
import AtdKeyboardCore
import AtdModel
import AtdPinyin
import UIKit

typealias Session = KeyboardSession<PinyinEngine>

/// A panel that takes the place of the keys.
enum Panel: Equatable {
  case candidates
  case clipboard
  /// A command's options, by the command's id.
  case options(String)
}

/// What a tap on the strip does.
enum StripTap: Equatable {
  case openAsk
  case run(Command)
  case undo
  case retry
  case pick(PinyinCandidate)
  case predict(String)
  case continueText
  case version(Int)
  case act(AskSuggestion)
  case pickOnAsk(PinyinCandidate)
  case showFullAccessPath
}

/// A chip on the strip: a command, a version, a suggestion.
struct StripChip: Equatable {
  var title: String
  var symbol: String?
  var tint: CommandTint?
  var isLead = false
  var isSelected = false
  var isBusy = false
  var tap: StripTap
  /// Holding it opens this command's options.
  var options: String?
}

enum StripItem: Equatable {
  case chip(StripChip)
  case candidate(String, emphasized: Bool, StripTap)
  case line(String, StripTap?)
  case tag(String)
}

/// The button at the strip's trailing end.
enum StripEnd: Equatable {
  case none
  case clipboard
  case candidates(open: Bool)
  case regenerate(enabled: Bool)
}

/// What the strip shows, worked out from the session's `Strip` and the open panel. Compared
/// between renders, so the strip is rebuilt only when this changes (not on every streamed delta).
struct StripContent: Equatable {
  /// The ✦ at the leading end; nil while it is hidden.
  var mark: MarkRole?
  var items: [StripItem] = []
  var end = StripEnd.none
  /// A panel's title in place of everything else.
  var header: Header?

  enum MarkRole: Equatable {
    case ask
    case refine
  }

  struct Header: Equatable {
    var title: String
    /// Leaving the panel is 完成 (the options of a command) rather than 返回.
    var isDone: Bool
  }

  init(_ strip: Strip, panel: Panel?, commands: [Command], showsPath: Bool) {
    switch panel {
    case .clipboard:
      header = Header(title: KeyboardText.string("panel.clipboard"), isDone: false)
      return
    case .options(let id):
      header = Header(title: commands.first { $0.id == id }?.name ?? "", isDone: true)
      return
    case .candidates, nil:
      break
    }
    switch strip {
    case .ask(let ask):
      items = ask.letters.isEmpty ? Self.suggestions(ask) : Self.composing(ask)
      end = ask.letters.isEmpty ? .none : .candidates(open: panel == .candidates)
    case .preview(let preview):
      mark = .refine
      items = [.tag(KeyboardText.string("strip.previewing"))] + Self.versions(preview)
      end = .regenerate(enabled: preview.canRegenerate)
    case .candidates(let candidates):
      items = candidates.enumerated().map { index, candidate in
        .candidate(candidate.text, emphasized: index == 0, .pick(candidate))
      }
      end = .candidates(open: panel == .candidates)
    case .predictions(let predictions):
      mark = .ask
      let next = StripChip(
        title: KeyboardText.string("strip.continue"), symbol: "sparkle", tap: .continueText)
      items =
        (predictions.offersContinuation ? [.chip(next)] : [])
        + predictions.words.map { .candidate($0, emphasized: false, .predict($0)) }
      end = .clipboard
    case .tools(let tools):
      mark = .ask
      items = Self.tools(tools, showsPath: showsPath)
      end = .clipboard
    }
  }

  private static func tools(_ tools: Tools, showsPath: Bool) -> [StripItem] {
    var items: [StripItem] = []
    if tools.canUndo {
      let title =
        tools.undoName.map { KeyboardText.string("strip.undo \($0)") }
        ?? KeyboardText.string("strip.undo")
      items.append(.chip(StripChip(title: title, symbol: "arrow.uturn.backward", tap: .undo)))
    }
    switch tools.line {
    case .fullAccessOff:
      items.append(
        showsPath
          ? .line(KeyboardText.string("strip.fullAccessPath"), nil)
          : .line(KeyboardText.string("strip.fullAccessOff"), .showFullAccessPath))
    case .noModel:
      items.append(.line(ModelFailure.noModel.message, nil))
    case .failure(let failure):
      items.append(.line(failure.message, nil))
      if failure.canRetry {
        let retry = StripChip(
          title: KeyboardText.string("strip.retry"), symbol: "arrow.clockwise", tap: .retry)
        items.append(.chip(retry))
      }
    case nil:
      items += tools.commands.map { .chip(chip(for: $0, isLead: $0.readsFreshCopy)) }
      if tools.commands.isEmpty, !tools.canUndo {
        let hint = StripChip(
          title: KeyboardText.string("strip.hint"), symbol: "sparkle", tap: .openAsk)
        items.append(.chip(hint))
      }
    }
    return items
  }

  private static func chip(for chip: CommandChip, isLead: Bool) -> StripChip {
    let command = chip.command
    let title =
      chip.readsFreshCopy && command.id == BuiltinCommands.replyID
      ? KeyboardText.string("strip.freshReply") : command.name
    return StripChip(
      title: title, symbol: command.symbol, tint: command.tint, isLead: isLead,
      tap: .run(command), options: command.options.isEmpty ? nil : command.id)
  }

  private static func versions(_ preview: AtdKeyboardCore.Preview) -> [StripItem] {
    preview.versions.enumerated().map { index, version in
      .chip(
        StripChip(
          title: title(of: version.label), isSelected: index == preview.selected,
          isBusy: version.state == .streaming, tap: .version(index)))
    }
  }

  static func title(of label: AtdKeyboardCore.Preview.Label) -> String {
    switch label {
    case .original: KeyboardText.string("version.original")
    case .option(let value), .command(let value), .refinement(let value): value
    case .request: KeyboardText.string("version.request")
    case .continuation: KeyboardText.string("version.continuation")
    }
  }

  private static func composing(_ ask: AskStrip) -> [StripItem] {
    ask.hits.map { .chip(suggestion($0, isLead: false)) }
      + ask.candidates.enumerated().map { index, candidate in
        .candidate(
          candidate.text, emphasized: index == 0 && ask.hits.isEmpty, .pickOnAsk(candidate))
      }
  }

  private static func suggestions(_ ask: AskStrip) -> [StripItem] {
    let typed = !ask.text.trimmingCharacters(in: .whitespaces).isEmpty
    return ask.suggestions.enumerated().map { index, suggestion in
      .chip(Self.suggestion(suggestion, isLead: typed && index == 0))
    }
  }

  private static func suggestion(_ suggestion: AskSuggestion, isLead: Bool) -> StripChip {
    switch suggestion {
    case .command(let command):
      var chip = chip(for: command, isLead: isLead)
      chip.tap = .act(suggestion)
      return chip
    case .phrase(let phrase):
      return StripChip(
        title: phrase.title, symbol: "text.quote", isLead: isLead, tap: .act(suggestion))
    case .write:
      return StripChip(
        title: KeyboardText.string("ask.writeIt"), symbol: "wand.and.sparkles", isLead: isLead,
        tap: .act(suggestion))
    case .refine(let request, let typed):
      return StripChip(
        title: typed ? KeyboardText.string("ask.changeIt") : request,
        symbol: typed ? "wand.and.sparkles" : nil, isLead: isLead, tap: .act(suggestion))
    }
  }
}
