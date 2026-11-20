import AtdModel
import SwiftUI

extension Command {
  /// The name as typed, or a stand-in while it is empty.
  var displayName: String {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? AppText.string("commands.untitled") : name
  }

  /// A row's one secondary line: where the command shows up, in plain words. A place that cannot
  /// run it is left out, as it never shows up there.
  var whereLabel: String {
    let places = Surface.available.filter { placement[$0] && runs(on: $0) }.map(\.shortLabel)
    return places.isEmpty
      ? AppText.string("commands.nowhere") : places.formatted(.list(type: .and, width: .narrow))
  }

  /// Built-in commands can be taken out of every entry point but not deleted.
  var isBuiltin: Bool {
    BuiltinCommands.ids.contains(id)
  }
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
