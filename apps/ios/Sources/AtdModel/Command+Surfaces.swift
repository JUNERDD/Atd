extension Command {
  /// Whether `surface` can run this command, so that placing it there means something.
  ///
  /// - The keyboard reads the field, the clipboard or nothing, and writes the result into the
  ///   field.
  /// - The share sheet and the camera hand over what was shared or photographed, so they need a
  ///   command that reads something.
  /// - Controls and Siri run every command: a control runs a no-input command in place, opens Atd
  ///   for one that reads the clipboard, and opens the camera for one that reads a photo; Siri and
  ///   Shortcuts take each kind of input.
  ///
  /// The one rule the 出现在 switches, the keyboard's strip, drafting and every entry point follow.
  public func runs(on surface: Surface) -> Bool {
    switch surface {
    case .keyboard:
      [.text, .copied, .none].contains(input) && [.replace, .insert].contains(output.action)
    case .share, .camera:
      input != CommandInput.none
    case .controls, .siri:
      true
    }
  }
}
