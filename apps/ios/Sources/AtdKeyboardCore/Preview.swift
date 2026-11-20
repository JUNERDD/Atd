import AtdAI
import AtdModel
import AtdPinyin
import Foundation

/// A result previewed in the field as marked text, and its versions. Only the version on show is
/// made when the command runs; the others are made when picked, then kept.
public struct Preview: Equatable {
  public enum Label: Equatable, Hashable {
    /// The person's own text, before the command (原文).
    case original
    /// One choice of the command's version option (正式).
    case option(String)
    /// A command without a version option, by its name.
    case command(String)
    /// A refinement of the version it was made from (再短点).
    case refinement(String)
    /// A request typed on the ✦ line (按要求).
    case request
    /// ✦ 续写.
    case continuation
  }

  public struct Version: Equatable {
    public enum State: Equatable {
      /// Made when it is picked.
      case notStarted
      case streaming
      case complete
    }

    public let label: Label
    /// The text so far, as the field shows it.
    public internal(set) var text: String
    public internal(set) var state: State
    /// How it is made; nil for the original.
    let recipe: Recipe?

    init(label: Label, text: String = "", state: State = .notStarted, recipe: Recipe?) {
      self.label = label
      self.text = text
      self.state = state
      self.recipe = recipe
    }
  }

  /// The command that made it; nil for a typed request or ✦ 续写.
  public let command: Command?
  public internal(set) var versions: [Version]
  public internal(set) var selected: Int
  /// The quick refinements the ✦ line offers while it is on show (再短点 · 正式点 · 加个表情).
  public let adjustments: [String]
  /// What it took out of the field, which 还原 puts back.
  let original: String
  let documentID: UUID
  /// The command writes back without review (先预览再写回 off): every version is taken when done.
  let autoAccept: Bool
  /// 用这个 was pressed while the version on show was streaming.
  var acceptsWhenDone: Bool

  /// - Parameter versions: the new versions; the original leads them when it has text, and the
  ///   first new one is on show.
  init(
    command: Command?, original: String, versions: [Version], adjustments: [String],
    documentID: UUID, autoAccept: Bool = false
  ) {
    let lead =
      original.isEmpty
      ? [] : [Version(label: .original, text: original, state: .complete, recipe: nil)]
    self.command = command
    self.versions = lead + versions
    selected = lead.count
    self.adjustments = adjustments
    self.original = original
    self.documentID = documentID
    self.autoAccept = autoAccept
    acceptsWhenDone = autoAccept
  }

  public var shown: Version { versions[selected] }

  public var isStreaming: Bool { versions.contains { $0.state == .streaming } }

  /// ↻ 换一批 makes the version on show again; the original has nothing to remake.
  public var canRegenerate: Bool { !isStreaming && shown.recipe != nil }
}

/// What one version is made from.
struct Recipe: Equatable {
  var kind: CommandPrompt.Kind
  var input: String
  var draft: String?
  var refinements: [CommandPrompt.Refinement] = []
  var choice: ModelChoice = .appDefault

  var request: ModelRequest {
    CommandPrompt.request(kind, input: input, draft: draft, refinements: refinements)
  }
}

/// What a tap started, which 重试 runs again from the field as it is now.
enum Run: Equatable {
  case command(Command)
  case request(String)
  case continuation
}

/// A result just taken, which 撤销 replaces with what it replaced.
struct Taken: Equatable {
  var original: String
  var result: String
  var documentID: UUID
  /// The command that made it, for 撤销润色.
  var name: String?
}

/// The ✦ line's own text and composition.
struct AskLine: Equatable {
  var text = ""
  var letters = ""
  var conversion: PinyinConversion?
}

/// The field as last read: what the strip ranks by and what commands read.
struct FieldSnapshot: Equatable {
  var documentID: UUID?
  var before = ""
  var after = ""
  var selection = ""
  var hasText = false

  /// What a command reads: the selection, or the text the host shares around the cursor.
  var readable: String { selection.isEmpty ? before + after : selection }

  var hasReadableText: Bool { !readable.trimmed.isEmpty }
}

/// The clipboard as last checked, without reading its text.
struct ClipboardSnapshot: Equatable {
  var changeCount = 0
  var hasText = false
}

extension String {
  var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

extension Character {
  /// A letter the pinyin engine reads.
  var isPinyinLetter: Bool { isASCII && isLowercase }

  /// Joins letters already being composed: a syllable boundary, or a capital the engine keeps
  /// as typed.
  var continuesPinyin: Bool { self == "'" || (isASCII && isUppercase) }
}
