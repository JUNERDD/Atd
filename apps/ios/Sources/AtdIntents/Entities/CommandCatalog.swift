import AtdModel
import Foundation

/// Which commands each entry point offers, read from the library as stored, in its order.
public enum CommandCatalog {
  /// What `surface` offers: the commands whose switch for it is on and that can run there. Siri,
  /// Shortcuts and Spotlight list `.siri`; the 运行指令 control lists `.controls`.
  public static func commands(on surface: Surface, in library: CommandLibrary) -> [Command] {
    library.commands.filter { $0.placement[surface] && $0.runs(on: surface) }
  }

  /// The commands whose name contains `text`, ignoring case, width and accents; all of them for
  /// blank text.
  public static func matching(_ text: String, in commands: [Command]) -> [Command] {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return commands }
    let options: String.CompareOptions = [
      .caseInsensitive, .widthInsensitive, .diacriticInsensitive,
    ]
    return commands.filter { $0.name.range(of: text, options: options) != nil }
  }
}
