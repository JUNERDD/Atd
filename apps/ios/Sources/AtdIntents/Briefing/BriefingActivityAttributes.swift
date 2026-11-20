import ActivityKit
import AtdModel
import Foundation

/// What a command's Live Activity shows: 今日简报's, and that of any command that reads nothing
/// run from the 运行指令 control, which works like 今日简报 and looks the same.
public struct BriefingActivityAttributes: ActivityAttributes, Sendable {
  public struct ContentState: Codable, Hashable, Sendable {
    public enum Phase: String, Codable, Sendable {
      /// The model is writing.
      case working
      /// `lines` holds the result.
      case done
      /// 今日简报 may not read the calendar or reminders yet: 允许访问日历 asks.
      case needsAccess
      /// No model connection: 添加模型 opens 我的 › 模型.
      case noModel
      /// `message` says why; 重试 shows when `canRetry`.
      case failed
    }

    public var phase: Phase
    /// The result's first lines, such as the briefing's sentences.
    public var lines: [String]
    public var message: String?
    public var canRetry: Bool

    /// The Lock Screen shows up to five rows of these lines. Clamping keeps the state far below
    /// ActivityKit's 4 KB for attributes and state together.
    public static let lineLimit = 3
    public static let characterLimit = 120

    public init(phase: Phase, lines: [String] = [], message: String? = nil, canRetry: Bool = false)
    {
      self.phase = phase
      self.lines = lines.prefix(Self.lineLimit).map(Self.clamped)
      self.message = message.map(Self.clamped)
      self.canRetry = canRetry
    }

    static func clamped(_ text: String) -> String {
      text.count > characterLimit ? String(text.prefix(characterLimit - 1)) + "…" : text
    }
  }

  public var commandID: String
  public var name: String
  public var symbol: String
  public var tint: CommandTint
  /// When the run started, for the date in the header.
  public var day: Date

  public init(command: Command, day: Date) {
    commandID = command.id
    name = ContentState.clamped(command.name)
    symbol = command.symbol
    tint = command.tint
    self.day = day
  }
}
