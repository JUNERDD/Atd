import AtdAI
import AtdModel
import AtdPinyin

/// What the strip above the keys shows. One state at a time, in this priority: the ✦ line, a
/// result on show, pinyin candidates, predictions after a commit, then the commands.
public enum Strip: Equatable {
  case ask(AskStrip)
  case preview(Preview)
  /// The readings of the letters being composed, best first.
  case candidates([PinyinCandidate])
  case predictions(Predictions)
  case tools(Tools)
}

/// The commands for the field as it is, or the one line that takes their place.
public struct Tools: Equatable {
  /// 撤销 leads the strip right after a result was taken.
  public var canUndo: Bool
  /// Ranked: a command for what was just copied, then commands for the field's text, then
  /// commands for an older copy. Empty when a line takes their place.
  public var commands: [CommandChip]
  public var line: ToolLine?
}

public struct CommandChip: Equatable, Hashable {
  public var command: Command
  /// It reads a copy made since the keyboard last read the clipboard: the reply command is then
  /// labelled 回复刚拷贝的.
  public var readsFreshCopy: Bool
}

/// One line in place of the commands.
public enum ToolLine: Equatable {
  /// Typing works offline; commands need Full Access, which the controller shows the way to.
  case fullAccessOff
  /// No provider connection in Atd yet.
  case noModel
  /// The last request failed and the field is back as it was; 重试 when `canRetry`.
  case failure(ModelFailure)
}

/// What the strip offers right after a commit, until typing pauses.
public struct Predictions: Equatable {
  /// ✦ 续写 comes first; it sends the text before the cursor only when tapped.
  public var offersContinuation: Bool
  /// What often follows the committed text.
  public var words: [String]
}

/// The ✦ line: an instruction typed with the same keys, and what it can run.
public struct AskStrip: Equatable {
  /// What the instruction is for, which the line's placeholder says.
  public enum Purpose: Equatable {
    /// Changing the result on show (再怎么改？).
    case refine
    /// Changing the text in the field (这段怎么改？).
    case rewrite
    /// Writing something new (想写什么？).
    case write
  }

  public var purpose: Purpose
  public var text: String
  /// Pinyin being composed on the line.
  public var letters: String
  public var candidates: [PinyinCandidate]
  /// Commands and phrases the letters spell (fy → 翻译), shown ahead of the candidates.
  public var hits: [AskSuggestion]
  /// What the line can run; return runs the first one.
  public var suggestions: [AskSuggestion]
}

public enum AskSuggestion: Equatable, Hashable {
  case command(CommandChip)
  case phrase(Phrase)
  /// 按要求写: runs the typed text as a request.
  case write(String)
  /// Asks for a change to the result on show: a quick refinement, or the typed text (按要求改).
  case refine(String, typed: Bool)
}

/// What the keys do in the current state, for their labels.
public struct KeyRoles: Equatable {
  /// Space takes the result on show (用这个) and delete puts the original back (还原).
  public var controlsPreview: Bool
  public var returnKey: ReturnKey
}

public enum ReturnKey: Equatable {
  /// 确认: commits the letters as typed.
  case confirm
  /// 生成 on the ✦ line.
  case generate(isEnabled: Bool)
  /// The host's own return (发送, 换行…), which the controller labels from `returnKeyType`.
  case host(isEnabled: Bool)
}
