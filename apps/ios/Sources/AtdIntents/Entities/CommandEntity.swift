import AppIntents
import AtdModel
import Foundation

/// A command in the library, as Siri, Shortcuts, Spotlight and the 运行指令 control name it.
///
/// It carries only what a picker shows: whoever runs it reads the command from the library by
/// `id`, so a run always uses the instructions and options as they are now.
public struct CommandEntity: AppEntity, IndexedEntity {
  public static var typeDisplayRepresentation: TypeDisplayRepresentation {
    TypeDisplayRepresentation(name: LocalizedStringResource("command.type", table: "EntryIntents"))
  }

  public static var defaultQuery: CommandQuery { CommandQuery() }

  public let id: String
  public let name: String
  public let symbol: String

  public init(_ command: Command) {
    id = command.id
    name = command.name
    symbol = command.symbol
  }

  public var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", image: DisplayRepresentation.Image(systemName: symbol))
  }
}

/// Siri's, Shortcuts' and Spotlight's view of the library: the commands placed in Siri. Looking
/// one up by id finds any command still in the library, so a saved shortcut keeps working after
/// its command leaves Siri.
public struct CommandQuery: EntityStringQuery {
  public init() {}

  public func entities(for identifiers: [CommandEntity.ID]) async throws -> [CommandEntity] {
    let library = try EntryContext.live().library
    return identifiers.compactMap { library.command($0).map(CommandEntity.init) }
  }

  public func entities(matching string: String) async throws -> [CommandEntity] {
    let commands = CommandCatalog.commands(on: .siri, in: try EntryContext.live().library)
    return CommandCatalog.matching(string, in: commands).map(CommandEntity.init)
  }

  public func suggestedEntities() async throws -> [CommandEntity] {
    CommandCatalog.commands(on: .siri, in: try EntryContext.live().library)
      .map(CommandEntity.init)
  }
}

/// The 运行指令 control's choices: the commands placed in controls.
public struct ControlCommandOptions: DynamicOptionsProvider {
  public init() {}

  public func results() async throws -> [CommandEntity] {
    CommandCatalog.commands(on: .controls, in: try EntryContext.live().library)
      .map(CommandEntity.init)
  }
}
