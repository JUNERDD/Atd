import Foundation

/// The commands whose options the shell offers (`commandOptions.set`): the enabled commands with
/// at least one parameter, each with its name and options as they stand (remembered values
/// applied). A command in the catalog gets the selection toolbar's options menu, the HUD's options
/// card and the hold gesture of its shortcut; any other runs as it is. Each push replaces the whole
/// catalog.
public struct CommandOptionsCatalog: Equatable, Sendable {
  public struct Entry: Equatable, Sendable {
    public let id: String
    /// The command's name, user data shown untranslated.
    public let name: String
    /// The command's options in parameter order; never empty.
    public let options: [CommandOption]

    public init(id: String, name: String, options: [CommandOption]) {
      self.id = id
      self.name = name
      self.options = options
    }
  }

  private var entries: [String: Entry] = [:]

  public init() {}

  /// The catalog `commandOptions.set` pushed. The page sends each command once; should an id
  /// repeat, its first entry stands.
  public init(_ params: CommandOptionsSetParams) {
    for command in params.commands where entries[command.id] == nil {
      entries[command.id] = Entry(id: command.id, name: command.name, options: command.options)
    }
  }

  public var isEmpty: Bool { entries.isEmpty }

  /// The command `id` with its options, or nil when the shell offers none for it.
  public func entry(for id: String) -> Entry? { entries[id] }

  public func contains(_ id: String) -> Bool { entries[id] != nil }
}

extension CommandArguments {
  /// The values `options` show: each choice's value and each toggle's state; input options carry
  /// none, since only the panel fills them.
  public init(values options: [CommandOption]) {
    var choices: [String: String] = [:]
    var toggles: [String: Bool] = [:]
    for option in options {
      switch option {
      case .choice(let choice): choices[choice.key] = choice.value
      case .toggle(let toggle): toggles[toggle.key] = toggle.value
      case .input: break
      }
    }
    self.init(choices: choices, toggles: toggles)
  }
}
