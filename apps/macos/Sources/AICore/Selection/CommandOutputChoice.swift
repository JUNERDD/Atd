import Foundation

/// Where a run's answer goes (``CommandOutputOption``), as the shell's options offer it: one more
/// choice after the command's parameters, so the toolbar's options menu and the island's options
/// card show, change and pick it like any other choice. Its key, ``key``, can never be a
/// parameter's (a parameter key starts with a letter), and it never crosses the bridge as a
/// choice: ``CommandArguments/init(values:)`` sends its value as `output`.
///
/// The choice lists the actions in the command settings' order, leaving out the two on the
/// selection for a command that does not read it, and names the command's saved action as the
/// default. A pick lasts for that run only; the page never remembers it.
public enum CommandOutputChoice {
  public static let key = "@output"

  /// Every action in the order the choice lists them.
  static let actions: [CommandOutputAction] = [
    .panel, .replaceSelection, .insertAfterSelection, .insertAtCursor, .copy,
  ]

  /// The words the choice shows, in the shell's language.
  public struct Names: Equatable, Sendable {
    /// The choice's label.
    public let label: String
    /// Each action's name.
    public let actions: [CommandOutputAction: String]
    /// The saved action's name, `%@` the action's.
    public let saved: String

    public init(label: String, actions: [CommandOutputAction: String], saved: String) {
      self.label = label
      self.actions = actions
      self.saved = saved
    }
  }

  /// `options` followed by the choice for `output`.
  public static func appending(
    _ output: CommandOutputOption, to options: [CommandOption], names: Names
  ) -> [CommandOption] {
    let offered = actions.filter {
      output.selection || ($0 != .replaceSelection && $0 != .insertAfterSelection)
    }
    let values = offered.map { action in
      let name = names.actions[action] ?? action.rawValue
      return CommandOption.Choice.Option(
        value: action.rawValue,
        label: action == output.saved ? String(format: names.saved, name) : name)
    }
    let choice = CommandOption.Choice(
      key: key, label: names.label, value: output.value.rawValue, options: values)
    return options + [.choice(choice)]
  }

  /// Whether `choice` is this one rather than a parameter's.
  public static func holds(_ choice: CommandOption.Choice) -> Bool { choice.key == key }
}

extension CommandOutputChoice.Names {
  /// The names in the String Catalog's language `text`.
  public init(_ text: ShellText) {
    self.init(
      label: text(.commandOptionsOutput),
      actions: [
        .panel: text(.commandOptionsOutputPanel),
        .replaceSelection: text(.commandOptionsOutputReplaceSelection),
        .insertAfterSelection: text(.commandOptionsOutputInsertAfterSelection),
        .insertAtCursor: text(.commandOptionsOutputInsertAtCursor),
        .copy: text(.commandOptionsOutputCopy),
      ],
      saved: text(.commandOptionsOutputSaved))
  }
}
