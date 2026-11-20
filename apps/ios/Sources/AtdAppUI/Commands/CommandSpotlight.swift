import Observation

/// A command another part of the app asks the 指令 tab to point out, such as one just saved from
/// 问 Atd (查看). The tab scrolls to its row, marks it for a moment and clears the request.
@Observable
final class CommandSpotlight {
  static let shared = CommandSpotlight()

  private(set) var commandID: String?

  func show(_ id: String) {
    commandID = id
  }

  func clear() {
    commandID = nil
  }
}
