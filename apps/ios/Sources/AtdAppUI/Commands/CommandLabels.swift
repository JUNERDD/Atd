import AtdModel
import SwiftUI

extension Command {
  /// The name as typed, or a stand-in while it is empty.
  var displayName: String {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? AppText.string("commands.untitled") : name
  }

  /// A row's one secondary line: where the command shows up, in plain words.
  var whereLabel: String {
    let places = Surface.available.filter { placement[$0] }.map(\.shortLabel)
    return places.isEmpty
      ? AppText.string("commands.nowhere") : places.formatted(.list(type: .and, width: .narrow))
  }

  /// Built-in commands can be taken out of every entry point but not deleted.
  var isBuiltin: Bool {
    Self.builtinIDs.contains(id)
  }

  /// The fixed ids of the commands a new library starts with, whichever this build ships.
  private static let builtinIDs = Set(BuiltinCommands.all().map(\.id))
}

extension Surface {
  /// The entry point's name in the 出现在 switches.
  var label: String {
    switch self {
    case .keyboard: AppText.string("surface.keyboard")
    case .share: AppText.string("surface.share")
    case .camera: AppText.string("surface.camera")
    case .controls: AppText.string("surface.controls")
    case .siri: AppText.string("surface.siri")
    }
  }

  /// The plain word on a command's row.
  var shortLabel: String {
    switch self {
    case .keyboard: AppText.string("surface.keyboard.short")
    case .share: AppText.string("surface.share.short")
    case .camera: AppText.string("surface.camera.short")
    case .controls: AppText.string("surface.controls.short")
    case .siri: AppText.string("surface.siri")
    }
  }
}

extension CommandInput {
  /// What the command reads, for the 读取 row.
  var label: String {
    switch self {
    case .text: AppText.string("input.text")
    case .copied: AppText.string("input.copied")
    case .shared: AppText.string("input.shared")
    case .image: AppText.string("input.image")
    case .none: AppText.string("input.none")
    }
  }
}

extension CommandOutput.Action {
  /// What happens to the result, for the 结果 row.
  var label: String {
    switch self {
    case .replace: AppText.string("output.replace")
    case .insert: AppText.string("output.insert")
    case .card: AppText.string("output.card")
    case .copy: AppText.string("output.copy")
    }
  }
}

/// Text a trial run starts from, so a built-in command can be tried with one tap. Commands the
/// person made start empty.
enum TrialSample {
  static func text(for command: Command) -> String {
    switch command.id {
    case BuiltinCommands.polishID: AppText.string("sample.polish")
    case BuiltinCommands.replyID: AppText.string("sample.reply")
    case BuiltinCommands.translateID: AppText.string("sample.translate")
    case BuiltinCommands.shortenID: AppText.string("sample.shorten")
    default: ""
    }
  }
}
