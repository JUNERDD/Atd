import Foundation

/// A JSON document the app and the keyboard share through the App Group (SharedStore).
///
/// Each file wraps its body with a `schemaVersion` and a `revision`. A body written with an older
/// schema goes through `migrate`; one this build cannot read starts over from `initial()`.
public protocol SharedDocument: Codable, Sendable, Equatable {
  static var fileName: String { get }
  /// The schema this build writes.
  static var schemaVersion: Int { get }
  /// The content of a missing or unreadable file.
  static func initial() -> Self
  /// Upgrades a whole file (`{ schemaVersion, revision, body }`) written with an older schema.
  static func migrate(_ file: Data, from version: Int) throws -> Self
}

extension SharedDocument {
  public static func migrate(_ file: Data, from version: Int) throws -> Self {
    throw SharedStoreError.unsupportedSchema(file: fileName, version: version)
  }
}

/// The command library (`library.json`).
public struct CommandLibrary: SharedDocument {
  public static let fileName = "library.json"
  public static let schemaVersion = 1

  public var commands: [Command]

  public init(commands: [Command]) {
    self.commands = commands
  }

  public static func initial() -> CommandLibrary {
    CommandLibrary(commands: BuiltinCommands.all())
  }

  public func command(_ id: String) -> Command? {
    commands.first { $0.id == id }
  }

  /// The commands placed in the keyboard, in library order.
  public var keyboardCommands: [Command] {
    commands.filter(\.placement.keyboard)
  }

  /// Replaces the command with the same id, or appends a new one.
  public mutating func upsert(_ command: Command) {
    if let index = commands.firstIndex(where: { $0.id == command.id }) {
      commands[index] = command
    } else {
      commands.append(command)
    }
  }

  public mutating func remove(_ id: String) {
    commands.removeAll { $0.id == id }
  }

  /// Remembers an option value, as the keyboard's options panel and the 指令 tab both do.
  public mutating func setValue(_ value: String, for key: String, in commandID: String) {
    guard let index = commands.firstIndex(where: { $0.id == commandID }) else { return }
    commands[index].setValue(value, for: key)
  }
}

/// Saved phrases (`phrases.json`).
public struct PhraseBook: SharedDocument {
  public static let fileName = "phrases.json"
  public static let schemaVersion = 1

  public var phrases: [Phrase]

  public init(phrases: [Phrase]) {
    self.phrases = phrases
  }

  public static func initial() -> PhraseBook {
    PhraseBook(phrases: Phrase.builtins())
  }
}

/// Provider connections and which one is the default (`settings.json`). Keys are in the Keychain.
public struct AppSettings: SharedDocument {
  public static let fileName = "settings.json"
  public static let schemaVersion = 1

  public var connections: [ProviderConnection]
  public var defaultConnectionID: String?

  public init(connections: [ProviderConnection] = [], defaultConnectionID: String? = nil) {
    self.connections = connections
    self.defaultConnectionID = defaultConnectionID
  }

  public static func initial() -> AppSettings {
    AppSettings()
  }

  /// The connection commands use unless they name their own; nil until a model is added.
  public var defaultConnection: ProviderConnection? {
    connections.first { $0.id == defaultConnectionID } ?? connections.first
  }

  public func connection(_ id: String) -> ProviderConnection? {
    connections.first { $0.id == id }
  }

  /// Adds or replaces a connection; the first one becomes the default.
  public mutating func upsert(_ connection: ProviderConnection) {
    if let index = connections.firstIndex(where: { $0.id == connection.id }) {
      connections[index] = connection
    } else {
      connections.append(connection)
    }
    if defaultConnectionID.flatMap(self.connection) == nil {
      defaultConnectionID = connections.first?.id
    }
  }

  public mutating func remove(_ id: String) {
    connections.removeAll { $0.id == id }
    if defaultConnectionID == id { defaultConnectionID = connections.first?.id }
  }
}

/// What the keyboard last reported (`keyboard-status.json`). It can write this only with Full
/// Access, so the app shows a status only when the file exists and never guesses otherwise.
public struct KeyboardStatus: SharedDocument {
  public static let fileName = "keyboard-status.json"
  public static let schemaVersion = 1

  /// The keyboard's CFBundleShortVersionString.
  public var version: String
  /// When the keyboard last appeared with Full Access.
  public var lastSeen: Date

  public init(version: String, lastSeen: Date) {
    self.version = version
    self.lastSeen = lastSeen
  }

  public static func initial() -> KeyboardStatus {
    KeyboardStatus(version: "", lastSeen: .distantPast)
  }

  public var hasReported: Bool { lastSeen > .distantPast }
}
