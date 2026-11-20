import Foundation
import Observation

/// A command run Atd shows in its own sheet once an entry point has brought it forward: the
/// 运行指令 control on a command that reads text, which runs on the clipboard, and a
/// command that reads nothing, such as 今日简报, while Live Activities are off.
public struct CommandRunRequest: Identifiable, Hashable, Sendable {
  public let id = UUID()
  public let commandID: String

  public init(commandID: String) {
    self.commandID = commandID
  }
}

/// Hands runs from intents to the app's root, which presents them (`CommandRunSheet`), the way
/// `RouteCenter` hands over routes.
///
/// It lives in memory only and has no URL form on purpose, so no other app can start a model
/// call on the clipboard: only an intent Atd runs, after the person pressed one of its controls.
@MainActor @Observable
public final class CommandRunCenter {
  public static let shared = CommandRunCenter()

  /// The latest run not yet presented.
  public private(set) var pending: CommandRunRequest?

  public init() {}

  public func open(_ request: CommandRunRequest) {
    pending = request
  }

  /// The pending run, which is no longer pending.
  public func take() -> CommandRunRequest? {
    defer { pending = nil }
    return pending
  }
}
