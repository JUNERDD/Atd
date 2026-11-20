import AppIntents
import AtdModel

/// The 运行指令 control's setting: which command it runs, from those placed in controls.
public struct RunCommandControlConfiguration: ControlConfigurationIntent {
  public static let title = LocalizedStringResource("runControl.title", table: "EntryIntents")
  public static let isDiscoverable = false

  @Parameter(
    title: LocalizedStringResource("runControl.command", table: "EntryIntents"),
    optionsProvider: ControlCommandOptions())
  public var command: CommandEntity?

  public init() {}

  public func perform() async throws -> some IntentResult {
    .result()
  }
}

/// What the 运行指令 control does with its command: one that reads nothing runs in the
/// background with a Live Activity, like 今日简报; one that reads a photo opens Atd's camera with
/// it; any other opens Atd and runs there on the clipboard (A25, A43).
public struct RunControlIntent: LiveActivityIntent {
  public static let title = LocalizedStringResource("runControl.title", table: "EntryIntents")
  public static let isDiscoverable = false
  public static let authenticationPolicy = IntentAuthenticationPolicy.alwaysAllowed
  public static let supportedModes: IntentModes = [.background, .foreground(.dynamic)]

  @Parameter(title: LocalizedStringResource("runControl.command", table: "EntryIntents"))
  public var commandID: String

  public init() {}

  public init(commandID: String) {
    self.commandID = commandID
  }

  @MainActor
  public func perform() async throws -> some IntentResult {
    try await ControlRun.perform(commandID: commandID, for: self)
    return .result()
  }
}

/// How a control or a widget button runs a command.
enum ControlRun {
  /// A command that reads nothing runs in a Live Activity while Live Activities are on; any other
  /// run brings Atd forward (unlocking first) and shows there: a photo command in the camera, the
  /// rest in the app's run sheet, which reads the clipboard for a command that reads text.
  @MainActor
  static func perform(commandID: String, for intent: some AppIntent) async throws {
    let context = try EntryContext.live()
    let command = try context.command(commandID)
    if command.input == .none, CommandActivity.isAvailable,
      await CommandActivity.run(command, context: context)
    {
      return
    }
    try await intent.continueInForeground(nil, alwaysConfirm: false)
    if command.input == .image {
      RouteCenter.shared.open(.camera(commandID: command.id))
    } else {
      CommandRunCenter.shared.open(CommandRunRequest(commandID: command.id))
    }
  }
}
