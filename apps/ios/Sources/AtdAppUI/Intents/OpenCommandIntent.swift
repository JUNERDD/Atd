import AppIntents
import AtdIntents
import AtdModel

/// What a command found in Spotlight, or picked in Shortcuts' 打开指令, opens: that command in
/// the 指令 tab.
public struct OpenCommandIntent: OpenIntent {
  public static let title = LocalizedStringResource("openCommand.title", table: "EntryIntents")
  public static let supportedModes: IntentModes = .foreground

  @Parameter(title: LocalizedStringResource("openCommand.target", table: "EntryIntents"))
  public var target: CommandEntity

  public init() {}

  @MainActor
  public func perform() async throws -> some IntentResult {
    RouteCenter.shared.open(.command(id: target.id))
    return .result()
  }
}
