/// The capture editor's text mode (the plan's 「选取文字」): the screenshot command row's way into
/// it and its shortcut to auto-redact, and the text command row it shows. The words both surfaces
/// share with the result card (the scope chip's, the copied capsule's) are
/// ``CaptureTextStringKey``'s. Command names and recognized text are user data and never pass
/// through here.
public enum CaptureTextModeStringKey: String, CaseIterable, ShellCatalogKey {
  /// The screenshot command row's button that enters text mode.
  case selectText = "captureTextMode.selectText"
  case selectTextTooltip = "captureTextMode.selectTextTooltip"
  /// Select Text's tooltip once the selection was read and held no text.
  case selectTextNone = "captureTextMode.selectTextNone"
  /// The screenshot command row's shortcut to the mosaic style bar's auto-redact (decision D7).
  case redact = "captureTextMode.redact"
  /// One `%lld`, with plural variations: the shortcut's tooltip, the items it covers.
  case redactTooltip = "captureTextMode.redactTooltip"
  /// The text command row's VoiceOver name.
  case label = "captureTextMode.label"
  /// One `%lld`, with plural variations: the scope chip while characters are selected.
  case scopeCharacters = "captureTextMode.scope.characters"
  /// One `%@`, the command's name: a text command's tooltip.
  case runTooltip = "captureTextMode.runTooltip"
  /// The text command row's Copy.
  case copy = "captureTextMode.copy"
  case copyTooltip = "captureTextMode.copyTooltip"
  /// The copied capsule after copying selected characters.
  case copiedCharacters = "captureTextMode.copied.characters"
  /// What VoiceOver says as text mode opens: how it is used.
  case entered = "captureTextMode.entered"
}
