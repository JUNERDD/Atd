import AppIntents
import AtdModel
import Foundation

/// 拍了就办 and 记一笔 from a control (Control Center, the Lock Screen, the Action button) or the
/// Camera Control. Unlocked, the system opens the app and runs `perform()`, which opens the
/// camera in the command's mode. Locked, it opens the capture extension instead (`Capture/`),
/// which reads the modes from `appContext` but cannot learn `commandID`: no API says which
/// control launched it, so it starts in the mode used last.
///
/// Apple requires the app, the capture extension and the widget extension (the controls) to all
/// declare it; they all link this module, which is what puts it in each bundle's App Intents
/// metadata. Its copy is in the `CameraIntents` table, compiled into all three bundles.
///
/// Conforming to `AppIntent`, which is `Sendable`, makes the type nonisolated even in this
/// main-actor module, so `perform()` says it runs on the main actor. Marking the type
/// `nonisolated` would also reach its `@Parameter`, which cannot be.
public struct CaptureIntent: CameraCaptureIntent {
  public typealias AppContext = CameraContext

  public static let title = LocalizedStringResource("capture.title", table: "CameraIntents")

  /// The command whose mode the camera opens in; empty for the mode used last. A camera
  /// capture intent's parameters must all have a default.
  @Parameter(
    title: LocalizedStringResource("capture.command", table: "CameraIntents"), default: "")
  public var commandID: String

  public init() {}

  public init(commandID: String?) {
    self.commandID = commandID ?? ""
  }

  @MainActor
  public func perform() async throws -> some IntentResult {
    RouteCenter.shared.open(.camera(commandID: commandID.isEmpty ? nil : commandID))
    return .result()
  }
}

/// Names the controls show, from the `CameraIntents` table like the intent's own title.
public nonisolated enum CaptureControlName {
  public static let expense = LocalizedStringResource("control.expense", table: "CameraIntents")
}

/// What the app tells the capture extension, which has no App Group to read the library from:
/// the camera's modes and the one to start in. The system keeps it for the extension
/// (`CaptureIntent.updateAppContext`); it must stay within `byteLimit` once encoded.
public nonisolated struct CameraContext: Codable, Sendable, Equatable {
  public static let byteLimit = 4096

  public var modes: [CameraMode]
  /// The mode used last, in the app or the extension.
  public var startModeID: String?

  public init(modes: [CameraMode], startModeID: String?) {
    self.modes = modes
    self.startModeID = startModeID
  }

  /// This context with modes left out from the end until it fits `byteLimit`; the start mode
  /// stays.
  public func fitted() -> CameraContext {
    var context = self
    while context.modes.count > 1, (try? JSONEncoder().encode(context).count) ?? 0 > Self.byteLimit
    {
      guard let index = context.modes.lastIndex(where: { $0.id != startModeID }) else { break }
      context.modes.remove(at: index)
    }
    return context
  }
}

/// A camera mode: a command with the camera placement, and the option its chip changes.
public nonisolated struct CameraMode: Codable, Sendable, Equatable, Hashable, Identifiable {
  public var id: String
  public var name: String
  public var symbol: String
  public var tint: CommandTint
  /// The command's first option, which the viewfinder's chip shows and changes.
  public var option: CameraModeOption?

  public init(
    id: String, name: String, symbol: String, tint: CommandTint, option: CameraModeOption?
  ) {
    self.id = id
    self.name = name
    self.symbol = symbol
    self.tint = tint
    self.option = option
  }

  public init(_ command: Command) {
    self.init(
      id: command.id, name: command.name, symbol: command.symbol, tint: command.tint,
      option: command.options.first.map(CameraModeOption.init))
  }

  /// The library's commands that are camera modes, in library order.
  public static func modes(in library: CommandLibrary) -> [CameraMode] {
    library.commands.filter(isMode).map(CameraMode.init)
  }

  /// Whether `command` is a camera mode: its camera placement is on and the camera can run it,
  /// giving the photo and its text as the input.
  public static func isMode(_ command: Command) -> Bool {
    command.placement.camera && command.runs(on: .camera)
  }

  /// The mode to open in: the one asked for when it is a mode, else the one used last, else
  /// 翻译, else the first.
  public static func start(in modes: [CameraMode], asked: String?, last: String?) -> CameraMode? {
    let ids = [asked, last, BuiltinCommands.translateID].compactMap { $0 }
    for id in ids {
      if let mode = modes.first(where: { $0.id == id }) { return mode }
    }
    return modes.first
  }
}

/// An option as the camera's chip shows it.
public nonisolated struct CameraModeOption: Codable, Sendable, Equatable, Hashable {
  public var key: String
  public var label: String
  public var choices: [String]
  /// The remembered value.
  public var value: String

  public init(key: String, label: String, choices: [String], value: String) {
    self.key = key
    self.label = label
    self.choices = choices
    self.value = value
  }

  public init(_ option: CommandOption) {
    self.init(key: option.key, label: option.label, choices: option.choices, value: option.value)
  }
}

/// The mode used last, shared by the app's camera and what it tells the capture extension.
public nonisolated enum CameraMemory {
  private static let key = "camera.lastModeID"

  public static var lastModeID: String? {
    get { UserDefaults.standard.string(forKey: key) }
    set { UserDefaults.standard.set(newValue, forKey: key) }
  }
}

/// This module's App Intents, listed by the app's, the capture extension's and the widget
/// extension's own packages.
nonisolated public struct AtdCameraUIPackage: AppIntentsPackage {}
