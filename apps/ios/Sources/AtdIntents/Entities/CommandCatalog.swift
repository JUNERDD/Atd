import AtdModel
import Foundation

/// Which commands each entry point offers, read from the library as stored, in its order.
public enum CommandCatalog {
  /// What `surface` offers: the commands whose switch for it is on and that can run there. Siri,
  /// Shortcuts and Spotlight list `.siri`; the 运行指令 control lists `.controls`.
  public static func commands(on surface: Surface, in library: CommandLibrary) -> [Command] {
    library.commands.filter { $0.placement[surface] && runs($0, on: surface) }
  }

  /// Where a command can run (A43): the keyboard runs what reads text or nothing and writes text
  /// back; the share sheet and the camera run what reads something; controls and Siri run every
  /// input. Root replaces this copy with `Command.runs(on:)` at merge.
  static func runs(_ command: Command, on surface: Surface) -> Bool {
    switch surface {
    case .keyboard:
      [.text, .copied, .none].contains(command.input)
        && [.replace, .insert].contains(command.output.action)
    case .share, .camera: command.input != .none
    case .controls, .siri: true
    }
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
